/**
 * Server API for the CaseFlow Lightning Web Components. Every query runs in
 * USER_MODE, so object, field and record access follow the worker's profile,
 * permission set and role.
 */
public with sharing class CaseController {

    public class UserContext {
        @AuraEnabled public String userName;
        @AuraEnabled public String roleName;
        @AuraEnabled public String roleDeveloperName;
        @AuraEnabled public Boolean canEscalate;
        @AuraEnabled public Boolean canReassign;
        @AuraEnabled public Boolean canViewTeam;
        @AuraEnabled public Boolean canManagePolicy;
    }

    public class CaseRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String caseNumber;
        @AuraEnabled public String subject;
        @AuraEnabled public String priority;
        @AuraEnabled public String status;
        @AuraEnabled public String department;
        @AuraEnabled public Integer level;
        @AuraEnabled public String levelLabel;
        @AuraEnabled public String slaStatus;
        @AuraEnabled public Datetime slaDue;
        @AuraEnabled public String ownerName;
        @AuraEnabled public String escalatedToName;
    }

    public class DashboardStats {
        @AuraEnabled public Integer open = 0;
        @AuraEnabled public Integer escalated = 0;
        @AuraEnabled public Integer breached = 0;
        @AuraEnabled public Integer escalatedToMe = 0;
        @AuraEnabled public Integer closedToday = 0;
        @AuraEnabled public Integer high = 0;
        @AuraEnabled public Integer medium = 0;
        @AuraEnabled public Integer low = 0;
    }

    @AuraEnabled(cacheable=true)
    public static UserContext getUserContext() {
        UserContext ctx = new UserContext();
        User me = [SELECT Name, UserRole.Name, UserRole.DeveloperName FROM User WHERE Id = :UserInfo.getUserId()];
        ctx.userName = me.Name;
        ctx.roleName = me.UserRole?.Name;
        ctx.roleDeveloperName = me.UserRole?.DeveloperName;
        ctx.canEscalate = FeatureManagement.checkPermission('Escalate_Case');
        ctx.canReassign = FeatureManagement.checkPermission('Reassign_Case');
        ctx.canViewTeam = FeatureManagement.checkPermission('View_Team_Cases');
        ctx.canManagePolicy = FeatureManagement.checkPermission('Manage_Escalation_Policy');
        return ctx;
    }

    @AuraEnabled(cacheable=true)
    public static DashboardStats getDashboardStats() {
        DashboardStats s = new DashboardStats();
        Id me = UserInfo.getUserId();
        Datetime now = Datetime.now();
        for (AggregateResult ar : [
            SELECT Priority p, COUNT(Id) n FROM Case WHERE IsClosed = false WITH USER_MODE GROUP BY Priority
        ]) {
            Integer n = (Integer) ar.get('n');
            String p = (String) ar.get('p');
            s.open += n;
            if (p == 'High') { s.high = n; }
            else if (p == 'Medium') { s.medium = n; }
            else if (p == 'Low') { s.low = n; }
        }
        s.escalated = [SELECT COUNT() FROM Case WHERE IsClosed = false AND Is_Escalated__c = true WITH USER_MODE];
        s.breached = [SELECT COUNT() FROM Case WHERE IsClosed = false AND SLA_Due__c < :now WITH USER_MODE];
        s.escalatedToMe = [SELECT COUNT() FROM Case WHERE IsClosed = false AND Escalated_To__c = :me WITH USER_MODE];
        s.closedToday = [SELECT COUNT() FROM Case WHERE IsClosed = true AND ClosedDate = TODAY WITH USER_MODE];
        return s;
    }

    /**
     * filter: MINE (open cases I own), ESCALATED_TO_ME, TEAM (all open cases I can see),
     * BREACHED (open cases past SLA), CLOSED (recently closed).
     * TEAM and BREACHED need the View_Team_Cases permission.
     */
    @AuraEnabled(cacheable=true)
    public static List<CaseRow> getCases(String filter) {
        String f = String.isBlank(filter) ? 'MINE' : filter.toUpperCase();
        if ((f == 'TEAM' || f == 'BREACHED') && !FeatureManagement.checkPermission('View_Team_Cases')) {
            throw auraError('You do not have access to team cases.');
        }

        Map<String, Object> binds = new Map<String, Object>{
            'me' => UserInfo.getUserId(),
            'now' => Datetime.now()
        };
        String q = 'SELECT Id, CaseNumber, Subject, Priority, Status, Department__c, Escalation_Level__c, ' +
                   'SLA_Status__c, SLA_Due__c, Owner.Name, Escalated_To__r.Name FROM Case WHERE ';
        switch on f {
            when 'ESCALATED_TO_ME' { q += 'IsClosed = false AND Escalated_To__c = :me'; }
            when 'TEAM' { q += 'IsClosed = false'; }
            when 'BREACHED' { q += 'IsClosed = false AND SLA_Due__c < :now'; }
            when 'CLOSED' { q += 'IsClosed = true'; }
            when else { q += 'IsClosed = false AND OwnerId = :me'; }
        }
        q += f == 'CLOSED' ? ' ORDER BY ClosedDate DESC LIMIT 50' : ' ORDER BY SLA_Due__c ASC NULLS LAST LIMIT 200';

        List<CaseRow> rows = new List<CaseRow>();
        for (Case c : (List<Case>) Database.queryWithBinds(q, binds, AccessLevel.USER_MODE)) {
            CaseRow r = new CaseRow();
            r.id = c.Id;
            r.caseNumber = c.CaseNumber;
            r.subject = c.Subject;
            r.priority = c.Priority;
            r.status = c.Status;
            r.department = c.Department__c;
            r.level = EscalationService.levelOf(c);
            r.levelLabel = EscalationService.levelLabel(r.level);
            r.slaStatus = c.SLA_Status__c;
            r.slaDue = c.SLA_Due__c;
            r.ownerName = c.Owner?.Name;
            r.escalatedToName = c.Escalated_To__r?.Name;
            rows.add(r);
        }
        return rows;
    }

    /** What will happen if this case is escalated now — shown in the Escalate quick action. */
    @AuraEnabled
    public static Map<String, Object> getEscalationPreview(Id caseId) {
        Case c = [
            SELECT Id, CaseNumber, Priority, IsClosed, Escalation_Level__c, SLA_Due__c, SLA_Status__c
            FROM Case WHERE Id = :caseId WITH USER_MODE
        ];
        Integer current = EscalationService.levelOf(c);
        Integer next = current + 1;
        Escalation_Policy__mdt policy = next <= EscalationService.MAX_LEVEL
            ? EscalationPolicyService.getPolicy(c.Priority, next) : null;
        return new Map<String, Object>{
            'caseNumber' => c.CaseNumber,
            'priority' => c.Priority,
            'isClosed' => c.IsClosed,
            'currentLevel' => current,
            'currentLabel' => EscalationService.levelLabel(current),
            'nextLevel' => next,
            'nextLabel' => EscalationService.levelLabel(next),
            'isMaxLevel' => current >= EscalationService.MAX_LEVEL,
            'targetQueue' => policy?.Target_Queue__c,
            'slaDue' => c.SLA_Due__c,
            'slaStatus' => c.SLA_Status__c,
            'canEscalate' => FeatureManagement.checkPermission('Escalate_Case')
        };
    }

    @AuraEnabled
    public static Map<String, Object> escalateCase(Id caseId, String reason, String comments) {
        if (!FeatureManagement.checkPermission('Escalate_Case')) {
            throw auraError('You do not have permission to escalate cases.');
        }
        if (String.isBlank(reason)) {
            throw auraError('Choose an escalation reason.');
        }
        Case c = [SELECT Id, IsClosed, Escalation_Level__c FROM Case WHERE Id = :caseId WITH USER_MODE];
        if (c.IsClosed) {
            throw auraError('Closed cases cannot be escalated. Reopen the case first.');
        }
        if (EscalationService.levelOf(c) >= EscalationService.MAX_LEVEL) {
            throw auraError('This case is already at the highest escalation level.');
        }

        List<Case> updated;
        try {
            updated = EscalationService.escalate(
                new Set<Id>{ caseId }, reason, comments, EscalationService.TYPE_MANUAL
            );
        } catch (DmlException e) {
            throw auraError(e.getDmlMessage(0));
        }
        if (updated.isEmpty()) {
            throw auraError('No escalation policy is configured for this case.');
        }

        Case u = updated[0];
        Integer lvl = u.Escalation_Level__c.intValue();
        String toName;
        if (u.Escalated_To__c != null) {
            toName = [SELECT Name FROM User WHERE Id = :u.Escalated_To__c].Name;
        }
        return new Map<String, Object>{
            'level' => lvl,
            'levelLabel' => EscalationService.levelLabel(lvl),
            'escalatedToName' => toName
        };
    }

    @AuraEnabled(cacheable=true)
    public static List<Escalation_Log__c> getEscalationHistory(Id caseId) {
        return [
            SELECT Id, Name, From_Level__c, To_Level__c, Reason__c, Comments__c, Escalated_At__c,
                   Escalation_Type__c, Escalated_By__r.Name, Escalated_To__r.Name
            FROM Escalation_Log__c
            WHERE Case__c = :caseId
            WITH USER_MODE
            ORDER BY Escalated_At__c DESC
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Escalation_Policy__mdt> getPolicies() {
        return EscalationPolicyService.getAll();
    }

    private static AuraHandledException auraError(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }
}
