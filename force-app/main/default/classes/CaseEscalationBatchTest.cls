@IsTest
private class CaseEscalationBatchTest {
    @TestSetup
    static void setup() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            TestDataFactory.createWorkers();
        }
    }

    @IsTest
    static void breachedCasesAreAutoEscalated() {
        Case breached = TestDataFactory.newCase('Server room AC failure', 'High');
        Case onTime = TestDataFactory.newCase('New monitor request', 'Low');
        insert new List<Case>{ breached, onTime };
        breached.SLA_Due__c = Datetime.now().addMinutes(-10);
        update breached;

        Test.startTest();
        Database.executeBatch(new CaseEscalationBatch(), 50);
        Test.stopTest();

        Case b = [SELECT Escalation_Level__c, Escalation_Reason__c FROM Case WHERE Id = :breached.Id];
        Assert.areEqual(1, b.Escalation_Level__c.intValue());
        Assert.areEqual('SLA Breach', b.Escalation_Reason__c);
        Assert.areEqual('Automatic', [SELECT Escalation_Type__c FROM Escalation_Log__c WHERE Case__c = :breached.Id].Escalation_Type__c);
        Assert.areEqual(0, [SELECT Escalation_Level__c FROM Case WHERE Id = :onTime.Id].Escalation_Level__c.intValue());
    }

    @IsTest
    static void schedulerCreatesFourJobs() {
        Test.startTest();
        List<Id> jobIds = CaseEscalationBatch.scheduleEvery15Minutes();
        Test.stopTest();
        Assert.areEqual(4, jobIds.size());
        Assert.areEqual(4, [SELECT COUNT() FROM CronTrigger WHERE Id IN :jobIds]);
    }

    @IsTest
    static void scheduledRunStartsBatch() {
        Test.startTest();
        new CaseEscalationBatch().execute((SchedulableContext) null);
        Test.stopTest();
        Assert.areEqual(1, [SELECT COUNT() FROM AsyncApexJob WHERE ApexClass.Name = 'CaseEscalationBatch' AND JobType = 'BatchApex']);
    }
}
