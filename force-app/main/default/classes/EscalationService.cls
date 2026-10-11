/**
 * Escalation engine. Moves cases one level up the support hierarchy, picks the
 * least-loaded active user in the target role (or the fallback queue) and
 * reassigns the case. The CaseTrigger then writes the audit log and notifies.
 *
 * Runs without sharing on purpose: an agent escalating a case must be able to
 * hand it to a Team Lead / Manager whose records the agent cannot see.
 * Callers (CaseController) check the Escalate_Case custom permission first.
 */
public without sharing class EscalationService {
    public static final Integer MAX_LEVEL = 3;
    public static final String TYPE_MANUAL = 'Manual';
    public static final String TYPE_AUTO = 'Automatic';

    /** Read by CaseTriggerHandler so the log records how the escalation happened. */
    public static String currentEscalationType = TYPE_MANUAL;

    public static String levelLabel(Integer level) {
        switch on level {
            when 0 { return 'Support Agent'; }
            when 1 { return 'Team Lead'; }
            when 2 { return 'Support Manager'; }
            when 3 { return 'Case Admin'; }
            when else { return 'Level ' + level; }
        }
    }

    public static Integer levelOf(Case c) {
        return c.Escalation_Level__c == null ? 0 : c.Escalation_Level__c.intValue();
    }

    public static List<Case> escalate(Set<Id> caseIds, String reason, String comments, String escalationType) {
        List<Case> result = new List<Case>();
        if (caseIds == null || caseIds.isEmpty()) {
            return result;
        }

        List<Case> cases = [
            SELECT Id, CaseNumber, Priority, OwnerId, IsClosed, Escalation_Level__c
            FROM Case
            WHERE Id IN :caseIds
        ];

        Map<Id, Escalation_Policy__mdt> policyByCase = new Map<Id, Escalation_Policy__mdt>();
        Set<String> roleNames = new Set<String>();
        Set<String> queueNames = new Set<String>();
        for (Case c : cases) {
            Integer next = levelOf(c) + 1;
            if (c.IsClosed || next > MAX_LEVEL) {
                continue;
            }
            Escalation_Policy__mdt policy = EscalationPolicyService.getPolicy(c.Priority, next);
            if (policy == null) {
                continue;
            }
            policyByCase.put(c.Id, policy);
            if (String.isNotBlank(policy.Target_Role__c)) {
                roleNames.add(policy.Target_Role__c);
            }
            if (String.isNotBlank(policy.Target_Queue__c)) {
                queueNames.add(policy.Target_Queue__c);
            }
        }
        if (policyByCase.isEmpty()) {
            return result;
        }

        Map<String, List<User>> usersByRole = loadUsersByRole(roleNames);
        Map<String, Id> queueIds = loadQueues(queueNames);
        Map<Id, Integer> workload = loadWorkload(usersByRole);

        for (Case c : cases) {
            Escalation_Policy__mdt policy = policyByCase.get(c.Id);
            if (policy == null) {
                continue;
            }
            Id target = pickLeastLoaded(usersByRole.get(policy.Target_Role__c), workload);
            Id newOwner = target != null ? target : queueIds.get(policy.Target_Queue__c);

            Case upd = new Case(
                Id = c.Id,
                Escalation_Level__c = levelOf(c) + 1,
                Escalation_Reason__c = reason,
                Escalation_Comments__c = comments,
                Escalated_To__c = target
            );
            if (newOwner != null) {
                upd.OwnerId = newOwner;
            }
            if (target != null) {
                workload.put(target, workload.get(target) + 1);
            }
            result.add(upd);
        }

        currentEscalationType = escalationType == null ? TYPE_MANUAL : escalationType;
        try {
            update result;
        } finally {
            currentEscalationType = TYPE_MANUAL;
        }
        return result;
    }

    private static Map<String, List<User>> loadUsersByRole(Set<String> roleNames) {
        Map<String, List<User>> byRole = new Map<String, List<User>>();
        if (roleNames.isEmpty()) {
            return byRole;
        }
        for (User u : [
            SELECT Id, UserRole.DeveloperName
            FROM User
            WHERE IsActive = true AND UserRole.DeveloperName IN :roleNames
        ]) {
            String role = u.UserRole.DeveloperName;
            if (!byRole.containsKey(role)) {
                byRole.put(role, new List<User>());
            }
            byRole.get(role).add(u);
        }
        return byRole;
    }

    private static Map<String, Id> loadQueues(Set<String> queueNames) {
        Map<String, Id> ids = new Map<String, Id>();
        if (queueNames.isEmpty()) {
            return ids;
        }
        for (Group g : [SELECT Id, DeveloperName FROM Group WHERE Type = 'Queue' AND DeveloperName IN :queueNames]) {
            ids.put(g.DeveloperName, g.Id);
        }
        return ids;
    }

    private static Map<Id, Integer> loadWorkload(Map<String, List<User>> usersByRole) {
        Map<Id, Integer> load = new Map<Id, Integer>();
        for (List<User> users : usersByRole.values()) {
            for (User u : users) {
                load.put(u.Id, 0);
            }
        }
        if (load.isEmpty()) {
            return load;
        }
        Set<Id> userIds = load.keySet();
        for (AggregateResult ar : [
            SELECT OwnerId o, COUNT(Id) n
            FROM Case
            WHERE IsClosed = false AND OwnerId IN :userIds
            GROUP BY OwnerId
        ]) {
            load.put((Id) ar.get('o'), (Integer) ar.get('n'));
        }
        return load;
    }

    private static Id pickLeastLoaded(List<User> candidates, Map<Id, Integer> workload) {
        if (candidates == null || candidates.isEmpty()) {
            return null;
        }
        Id best;
        Integer bestLoad;
        for (User u : candidates) {
            Integer l = workload.get(u.Id);
            if (best == null || l < bestLoad) {
                best = u.Id;
                bestLoad = l;
            }
        }
        return best;
    }
}
