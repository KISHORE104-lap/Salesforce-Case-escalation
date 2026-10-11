/**
 * Inserts audit rows in system context: every worker can escalate, but only
 * Case Admins may create or edit Escalation_Log__c records directly.
 */
public without sharing class EscalationLogWriter {
    public static void insertLogs(List<Escalation_Log__c> logs) {
        insert logs;
    }
}
