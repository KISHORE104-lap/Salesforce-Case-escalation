@IsTest
private class EscalationServiceTest {
    @TestSetup
    static void setup() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            TestDataFactory.createWorkers();
        }
    }

    @IsTest
    static void manualEscalationMovesCaseToTeamLeadAndLogsIt() {
        User agent = TestDataFactory.findUser('agent');
        Case c = TestDataFactory.newCase('Laptop not booting', 'High');
        System.runAs(agent) {
            insert c;
        }

        Test.startTest();
        System.runAs(agent) {
            EscalationService.escalate(new Set<Id>{ c.Id }, 'Technical Complexity', 'Needs hardware swap', EscalationService.TYPE_MANUAL);
        }
        Test.stopTest();

        Case after = [SELECT Escalation_Level__c, Is_Escalated__c, Escalated_On__c, OwnerId, Escalated_To__c, SLA_Due__c FROM Case WHERE Id = :c.Id];
        Assert.areEqual(1, after.Escalation_Level__c.intValue(), 'Case should be at Team Lead level');
        Assert.isTrue(after.Is_Escalated__c);
        Assert.isNotNull(after.Escalated_On__c);
        Assert.isNotNull(after.Escalated_To__c, 'A Team Lead should be chosen');
        Assert.areEqual(after.Escalated_To__c, after.OwnerId, 'Case should be reassigned to the Team Lead');
        Assert.areEqual('Team_Lead', [SELECT UserRole.DeveloperName FROM User WHERE Id = :after.OwnerId].UserRole.DeveloperName);
        Assert.isNotNull(after.SLA_Due__c, 'Next-level deadline should be set');

        Escalation_Log__c log = [SELECT From_Level__c, To_Level__c, Escalation_Type__c, Reason__c, Escalated_By__c FROM Escalation_Log__c WHERE Case__c = :c.Id];
        Assert.areEqual(0, log.From_Level__c.intValue());
        Assert.areEqual(1, log.To_Level__c.intValue());
        Assert.areEqual('Manual', log.Escalation_Type__c);
        Assert.areEqual('Technical Complexity', log.Reason__c);
        Assert.areEqual(agent.Id, log.Escalated_By__c);
    }

    @IsTest
    static void escalatesThroughAllLevelsAndStopsAtMax() {
        Case c = TestDataFactory.newCase('Payroll outage', 'High');
        insert c;

        Test.startTest();
        for (Integer i = 0; i < 4; i++) {
            EscalationService.escalate(new Set<Id>{ c.Id }, 'Customer Request', null, EscalationService.TYPE_MANUAL);
        }
        Test.stopTest();

        Case after = [SELECT Escalation_Level__c, SLA_Due__c, OwnerId FROM Case WHERE Id = :c.Id];
        Assert.areEqual(EscalationService.MAX_LEVEL, after.Escalation_Level__c.intValue());
        Assert.isNull(after.SLA_Due__c, 'No further deadline at the top level');
        Assert.areEqual('Case_Admin', [SELECT UserRole.DeveloperName FROM User WHERE Id = :after.OwnerId].UserRole.DeveloperName);
        Assert.areEqual(3, [SELECT COUNT() FROM Escalation_Log__c WHERE Case__c = :c.Id], 'One log per level');
    }

    @IsTest
    static void closedCasesAreNotEscalated() {
        Case c = TestDataFactory.newCase('Resolved request', 'Low');
        insert c;
        c.Status = 'Closed';
        update c;

        List<Case> result = EscalationService.escalate(new Set<Id>{ c.Id }, 'Agent Request', null, EscalationService.TYPE_MANUAL);

        Assert.isTrue(result.isEmpty());
        Assert.areEqual(0, [SELECT COUNT() FROM Escalation_Log__c WHERE Case__c = :c.Id]);
    }

    @IsTest
    static void spreadsWorkAcrossLeastLoadedTeamLeads() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            TestDataFactory.createUser('lead2', 'Team_Lead', 'CaseFlow_Team_Lead');
        }
        List<Case> cases = new List<Case>();
        for (Integer i = 0; i < 4; i++) {
            cases.add(TestDataFactory.newCase('Bulk ' + i, 'Medium'));
        }
        insert cases;

        Test.startTest();
        EscalationService.escalate(new Map<Id, Case>(cases).keySet(), 'Agent Request', null, EscalationService.TYPE_MANUAL);
        Test.stopTest();

        Set<Id> owners = new Set<Id>();
        for (Case c : [SELECT OwnerId FROM Case WHERE Id IN :cases]) {
            owners.add(c.OwnerId);
        }
        Assert.isTrue(owners.size() >= 2, 'Escalations should be shared between Team Leads');
    }

    @IsTest
    static void levelLabelsMatchHierarchy() {
        Assert.areEqual('Support Agent', EscalationService.levelLabel(0));
        Assert.areEqual('Team Lead', EscalationService.levelLabel(1));
        Assert.areEqual('Support Manager', EscalationService.levelLabel(2));
        Assert.areEqual('Case Admin', EscalationService.levelLabel(3));
        Assert.areEqual('Level 9', EscalationService.levelLabel(9));
        Assert.isTrue(EscalationService.escalate(new Set<Id>(), 'Agent Request', null, null).isEmpty());
    }
}
