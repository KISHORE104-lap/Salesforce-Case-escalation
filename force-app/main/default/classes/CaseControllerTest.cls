@IsTest
private class CaseControllerTest {
    @TestSetup
    static void setup() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            TestDataFactory.createWorkers();
            TestDataFactory.createUser('noperm', 'Support_Agent', null);
        }
    }

    @IsTest
    static void userContextReflectsWorkerProfile() {
        System.runAs(TestDataFactory.findUser('agent')) {
            CaseController.UserContext ctx = CaseController.getUserContext();
            Assert.isTrue(ctx.canEscalate);
            Assert.isFalse(ctx.canViewTeam);
            Assert.isFalse(ctx.canManagePolicy);
            Assert.areEqual('Support_Agent', ctx.roleDeveloperName);
        }
        System.runAs(TestDataFactory.findUser('cadmin')) {
            CaseController.UserContext ctx = CaseController.getUserContext();
            Assert.isTrue(ctx.canManagePolicy);
            Assert.isTrue(ctx.canViewTeam);
        }
    }

    @IsTest
    static void agentCanEscalateOwnCase() {
        User agent = TestDataFactory.findUser('agent');
        Case c = TestDataFactory.newCase('Email not syncing', 'Medium');
        System.runAs(agent) {
            insert c;
            Map<String, Object> preview = CaseController.getEscalationPreview(c.Id);
            Assert.areEqual('Team Lead', preview.get('nextLabel'));

            Test.startTest();
            Map<String, Object> res = CaseController.escalateCase(c.Id, 'Agent Request', 'Outside my access');
            Test.stopTest();
            Assert.areEqual(1, (Integer) res.get('level'));
            Assert.areEqual('Team Lead', res.get('levelLabel'));
        }
        Assert.areEqual(1, [SELECT COUNT() FROM Escalation_Log__c WHERE Case__c = :c.Id]);
    }

    @IsTest
    static void workerWithoutPermissionCannotEscalate() {
        Case c = TestDataFactory.newCase('Access request', 'Low');
        insert c;
        System.runAs(TestDataFactory.findUser('noperm')) {
            try {
                CaseController.escalateCase(c.Id, 'Agent Request', null);
                Assert.fail('Expected an AuraHandledException');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('permission'));
            }
            try {
                CaseController.getCases('TEAM');
                Assert.fail('Expected an AuraHandledException');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('team'));
            }
        }
    }

    @IsTest
    static void escalationGuardsRejectInvalidRequests() {
        System.runAs(TestDataFactory.findUser('cadmin')) {
            Case closedCase = TestDataFactory.newCase('Done', 'Low');
            Case topCase = TestDataFactory.newCase('Top', 'High');
            insert new List<Case>{ closedCase, topCase };
            closedCase.Status = 'Closed';
            topCase.Escalation_Level__c = 3;
            update new List<Case>{ closedCase, topCase };

            for (Id caseId : new List<Id>{ closedCase.Id, topCase.Id }) {
                try {
                    CaseController.escalateCase(caseId, 'Agent Request', null);
                    Assert.fail('Expected an AuraHandledException');
                } catch (AuraHandledException e) {
                    Assert.isNotNull(e.getMessage());
                }
            }
            try {
                CaseController.escalateCase(topCase.Id, '', null);
                Assert.fail('Expected an AuraHandledException');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('reason'));
            }
        }
    }

    @IsTest
    static void dashboardListsAndHistoryWork() {
        User mgr = TestDataFactory.findUser('mgr');
        System.runAs(mgr) {
            Case mine = TestDataFactory.newCase('Mine', 'High');
            Case late = TestDataFactory.newCase('Late', 'Low');
            insert new List<Case>{ mine, late };
            late.SLA_Due__c = Datetime.now().addHours(-2);
            update late;

            Test.startTest();
            CaseController.DashboardStats s = CaseController.getDashboardStats();
            Assert.areEqual(2, s.open);
            Assert.areEqual(1, s.high);
            Assert.areEqual(1, s.breached);

            Assert.areEqual(2, CaseController.getCases('MINE').size());
            Assert.areEqual(2, CaseController.getCases('TEAM').size());
            Assert.areEqual(1, CaseController.getCases('BREACHED').size());
            Assert.areEqual(0, CaseController.getCases('ESCALATED_TO_ME').size());
            Assert.areEqual(0, CaseController.getCases('CLOSED').size());

            CaseController.escalateCase(mine.Id, 'Customer Request', 'VIP customer');
            Test.stopTest();
        }
        Case mine = [SELECT Id FROM Case WHERE Subject = 'Mine'];
        System.runAs(TestDataFactory.findUser('cadmin')) {
            List<Escalation_Log__c> history = CaseController.getEscalationHistory(mine.Id);
            Assert.areEqual(1, history.size());
            Assert.isFalse(CaseController.getPolicies().isEmpty());
        }
    }
}
