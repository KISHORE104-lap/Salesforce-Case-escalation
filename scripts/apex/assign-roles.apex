// Gives each CaseFlow demo user the role that matches their worker profile.
// Users are matched by alias (set in config/users/*.json).
Map<String, String> roleByAlias = new Map<String, String>{
    'agent' => 'Support_Agent', 'lead' => 'Team_Lead', 'mgr' => 'Support_Manager', 'cadmin' => 'Case_Admin'
};
Map<String, Id> roleIds = new Map<String, Id>();
for (UserRole r : [SELECT Id, DeveloperName FROM UserRole WHERE DeveloperName IN :roleByAlias.values()]) {
    roleIds.put(r.DeveloperName, r.Id);
}
List<User> users = [SELECT Id, Alias FROM User WHERE Alias IN :roleByAlias.keySet() AND IsActive = true];
for (User u : users) {
    u.UserRoleId = roleIds.get(roleByAlias.get(u.Alias));
}
update users;
// Put the admin running this script at the top of the hierarchy too
update new User(Id = UserInfo.getUserId(), UserRoleId = roleIds.get('Case_Admin'));
System.debug('Roles assigned to ' + users.size() + ' users.');
