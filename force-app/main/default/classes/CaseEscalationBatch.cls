/**
 * Automatic, time-based escalation. Finds open cases whose SLA deadline has
 * passed and escalates them one level. Schedule with scheduleEvery15Minutes().
 */
public without sharing class CaseEscalationBatch implements Database.Batchable<SObject>, Schedulable {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        Datetime now = Datetime.now();
        Integer maxLevel = EscalationService.MAX_LEVEL;
        return Database.getQueryLocator([
            SELECT Id
            FROM Case
            WHERE IsClosed = false
              AND SLA_Due__c != null
              AND SLA_Due__c <= :now
              AND Escalation_Level__c < :maxLevel
        ]);
    }

    public void execute(Database.BatchableContext bc, List<Case> scope) {
        Set<Id> ids = new Map<Id, Case>(scope).keySet();
        EscalationService.escalate(
            ids,
            'SLA Breach',
            'Automatically escalated: SLA deadline passed.',
            EscalationService.TYPE_AUTO
        );
    }

    public void finish(Database.BatchableContext bc) {
    }

    public void execute(SchedulableContext sc) {
        Database.executeBatch(new CaseEscalationBatch(), 50);
    }

    /** Creates four hourly jobs (:00, :15, :30, :45) = a run every 15 minutes. */
    public static List<Id> scheduleEvery15Minutes() {
        List<Id> jobIds = new List<Id>();
        for (Integer m : new List<Integer>{ 0, 15, 30, 45 }) {
            String name = 'CaseFlow Auto-Escalation :' + String.valueOf(m).leftPad(2, '0');
            jobIds.add(System.schedule(name, '0 ' + m + ' * * * ?', new CaseEscalationBatch()));
        }
        return jobIds;
    }
}
