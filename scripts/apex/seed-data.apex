// Creates sample cases across departments and priorities.
// Run: sf apex run --file scripts/apex/seed-data.apex
List<Case> cases = new List<Case>();
List<String> subjects = new List<String>{
    'Laptop will not boot after update', 'VPN disconnects every 10 minutes', 'Payroll not credited for October',
    'Access card not working at Gate 3', 'Printer on 2nd floor jammed', 'New joiner needs email account',
    'Expense claim rejected incorrectly', 'AC failure in server room', 'Request for second monitor',
    'Leave balance shows wrong value', 'CRM login error for sales team', 'Water leakage near cafeteria'
};
List<String> depts = new List<String>{ 'IT Support', 'IT Support', 'Finance', 'Facilities', 'IT Support', 'IT Support',
    'Finance', 'Operations', 'IT Support', 'HR', 'IT Support', 'Facilities' };
List<String> priorities = new List<String>{ 'High', 'Medium', 'High', 'Medium', 'Low', 'Medium',
    'Low', 'High', 'Low', 'Medium', 'High', 'Medium' };
for (Integer i = 0; i < subjects.size(); i++) {
    cases.add(new Case(Subject = subjects[i], Department__c = depts[i], Priority = priorities[i],
        Status = 'New', Origin = 'Web', Description = 'Sample case created by CaseFlow seed script.'));
}
Database.DMLOptions opts = new Database.DMLOptions();
opts.assignmentRuleHeader.useDefaultRule = true;   // route through Tier 1 Support queue
Database.insert(cases, opts);

// Make three cases overdue so the auto-escalation batch has work to do
List<Case> overdue = new List<Case>{ cases[0], cases[2], cases[7] };
for (Case c : overdue) {
    c.SLA_Due__c = Datetime.now().addMinutes(-30);
}
update overdue;
System.debug('Seeded ' + cases.size() + ' cases, 3 overdue.');
