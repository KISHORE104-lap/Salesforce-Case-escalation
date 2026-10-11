/**
 * Keeps SLA fields in step with priority and escalation level, records SLA
 * outcome on close, and writes an Escalation_Log__c row for every escalation.
 */
public with sharing class CaseTriggerHandler {
    private static Set<String> closedStatuses;

    private static Set<String> getClosedStatuses() {
        if (closedStatuses == null) {
            closedStatuses = new Set<String>();
            for (CaseStatus s : [SELECT MasterLabel FROM CaseStatus WHERE IsClosed = true]) {
                closedStatuses.add(s.MasterLabel);
            }
        }
        return closedStatuses;
    }

    public static void beforeInsert(List<Case> newCases) {
        Datetime now = Datetime.now();
        for (Case c : newCases) {
            if (c.Escalation_Level__c == null) {
                c.Escalation_Level__c = 0;
            }
            if (String.isBlank(c.Priority)) {
                c.Priority = 'Medium';
            }
            c.SLA_Due__c = EscalationPolicyService.nextDeadline(c.Priority, EscalationService.levelOf(c), now);
        }
    }

    public static void beforeUpdate(List<Case> newCases, Map<Id, Case> oldMap) {
        Datetime now = Datetime.now();
        Set<String> closed = getClosedStatuses();
        for (Case c : newCases) {
            Case old = oldMap.get(c.Id);
            Integer newLevel = EscalationService.levelOf(c);
            Integer oldLevel = EscalationService.levelOf(old);
            Boolean isClosing = closed.contains(c.Status) && !closed.contains(old.Status);
            Boolean isReopening = !closed.contains(c.Status) && closed.contains(old.Status);

            if (newLevel > oldLevel) {
                c.Is_Escalated__c = true;
                c.Escalated_On__c = now;
                c.SLA_Due__c = EscalationPolicyService.nextDeadline(c.Priority, newLevel, now);
            } else if (c.Priority != old.Priority || isReopening) {
                Datetime base = isReopening ? now : (c.Escalated_On__c != null ? c.Escalated_On__c : c.CreatedDate);
                c.SLA_Due__c = EscalationPolicyService.nextDeadline(c.Priority, newLevel, base);
            }

            if (isClosing) {
                c.SLA_Met__c = (c.SLA_Due__c == null || now <= c.SLA_Due__c);
            } else if (isReopening) {
                c.SLA_Met__c = false;
            }
        }
    }

    public static void afterUpdate(List<Case> newCases, Map<Id, Case> oldMap) {
        List<Escalation_Log__c> logs = new List<Escalation_Log__c>();
        List<Case> escalated = new List<Case>();
        Datetime now = Datetime.now();
        for (Case c : newCases) {
            Integer newLevel = EscalationService.levelOf(c);
            Integer oldLevel = EscalationService.levelOf(oldMap.get(c.Id));
            if (newLevel > oldLevel) {
                logs.add(new Escalation_Log__c(
                    Case__c = c.Id,
                    From_Level__c = oldLevel,
                    To_Level__c = newLevel,
                    Escalated_By__c = UserInfo.getUserId(),
                    Escalated_To__c = c.Escalated_To__c,
                    Reason__c = c.Escalation_Reason__c,
                    Comments__c = c.Escalation_Comments__c,
                    Escalated_At__c = now,
                    Escalation_Type__c = EscalationService.currentEscalationType
                ));
                escalated.add(c);
            }
        }
        if (!logs.isEmpty()) {
            EscalationLogWriter.insertLogs(logs);
            EscalationNotifier.notify(escalated);
        }
    }
}
