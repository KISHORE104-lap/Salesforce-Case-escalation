@IsTest
public class TestDataFactory {
    public static User createUser(String alias, String roleDeveloperName, String permissionSetName) {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        Id roleId = null;
        if (roleDeveloperName != null) {
            roleId = [SELECT Id FROM UserRole WHERE DeveloperName = :roleDeveloperName LIMIT 1].Id;
        }
        String unique = alias + Math.abs(Crypto.getRandomInteger());
        User u = new User(
            Alias = alias.left(8),
            Email = unique + '@caseflow.test',
            Username = unique + '@caseflow.test',
            LastName = alias,
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_IN',
            TimeZoneSidKey = 'Asia/Kolkata',
            ProfileId = p.Id,
            UserRoleId = roleId
        );
        insert u;
        if (permissionSetName != null) {
            Id psId = [SELECT Id FROM PermissionSet WHERE Name = :permissionSetName LIMIT 1].Id;
            insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = psId);
        }
        return u;
    }

    /** Creates one user per worker profile. Call inside System.runAs to avoid mixed DML. */
    public static Map<String, User> createWorkers() {
        return new Map<String, User>{
            'agent' => createUser('agent', 'Support_Agent', 'CaseFlow_Support_Agent'),
            'lead' => createUser('lead', 'Team_Lead', 'CaseFlow_Team_Lead'),
            'manager' => createUser('mgr', 'Support_Manager', 'CaseFlow_Support_Manager'),
            'admin' => createUser('cadmin', 'Case_Admin', 'CaseFlow_Case_Admin')
        };
    }

    public static User findUser(String lastName) {
        return [SELECT Id FROM User WHERE LastName = :lastName AND Email LIKE '%@caseflow.test' LIMIT 1];
    }

    public static Case newCase(String subject, String priority) {
        return new Case(Subject = subject, Priority = priority, Status = 'New', Origin = 'Web', Department__c = 'IT Support');
    }
}
