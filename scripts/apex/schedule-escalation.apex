// Starts automatic SLA escalation every 15 minutes.
// Run: sf apex run --file scripts/apex/schedule-escalation.apex
for (CronTrigger ct : [SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE 'CaseFlow Auto-Escalation%']) {
    System.abortJob(ct.Id);
}
System.debug(CaseEscalationBatch.scheduleEvery15Minutes());
