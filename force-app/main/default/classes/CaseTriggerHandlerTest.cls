@IsTest
private class CaseTriggerHandlerTest {
    @IsTest
    static void insertSetsSlaFromPolicy() {
        Datetime before = Datetime.now();
        Case c = TestDataFactory.newCase('VPN down', 'High');
        insert c;
        Case after = [SELECT SLA_Due__c, Escalation_Level__c, SLA_Status__c FROM Case WHERE Id = :c.Id];

        Escalation_Policy__mdt p = EscalationPolicyService.getPolicy('High', 1);
        Integer minutes = (p.Hours_To_Escalate__c * 60).intValue();
        Assert.areEqual(0, after.Escalation_Level__c.intValue());
        Assert.isTrue(after.SLA_Due__c >= before.addMinutes(minutes).addSeconds(-5));
        Assert.isTrue(after.SLA_Due__c <= Datetime.now().addMinutes(minutes).addSeconds(5));
        Assert.areEqual('On Track', after.SLA_Status__c);
    }

    @IsTest
    static void blankPriorityDefaultsToMedium() {
        Case c = new Case(Subject = 'No priority', Status = 'New');
        insert c;
        Case after = [SELECT Priority, SLA_Due__c FROM Case WHERE Id = :c.Id];
        Assert.isNotNull(after.SLA_Due__c);
    }

    @IsTest
    static void priorityChangeRecalculatesSla() {
        Case c = TestDataFactory.newCase('Printer jam', 'Low');
        insert c;
        Datetime lowDue = [SELECT SLA_Due__c FROM Case WHERE Id = :c.Id].SLA_Due__c;

        c.Priority = 'High';
        update c;
        Datetime highDue = [SELECT SLA_Due__c FROM Case WHERE Id = :c.Id].SLA_Due__c;

        Assert.isTrue(highDue < lowDue, 'High priority must have a tighter deadline');
    }

    @IsTest
    static void closingWithinSlaMarksSlaMet() {
        Case c = TestDataFactory.newCase('Password reset', 'Medium');
        insert c;
        c.Status = 'Closed';
        update c;
        Case after = [SELECT SLA_Met__c, SLA_Status__c FROM Case WHERE Id = :c.Id];
        Assert.isTrue(after.SLA_Met__c);
        Assert.areEqual('Met', after.SLA_Status__c);
    }

    @IsTest
    static void closingAfterDeadlineMarksSlaMissedAndReopenResets() {
        Case c = TestDataFactory.newCase('Late fix', 'Medium');
        insert c;
        c.SLA_Due__c = Datetime.now().addHours(-1);
        update c;
        c.Status = 'Closed';
        update c;
        Assert.isFalse([SELECT SLA_Met__c FROM Case WHERE Id = :c.Id].SLA_Met__c);

        c.Status = 'Working';
        update c;
        Case reopened = [SELECT SLA_Due__c FROM Case WHERE Id = :c.Id];
        Assert.isTrue(reopened.SLA_Due__c > Datetime.now(), 'Reopened case gets a fresh deadline');
    }

    @IsTest
    static void policyListIsAvailable() {
        Assert.isFalse(EscalationPolicyService.getAll().isEmpty());
        Assert.isNull(EscalationPolicyService.nextDeadline('High', 3, Datetime.now()));
    }
}
