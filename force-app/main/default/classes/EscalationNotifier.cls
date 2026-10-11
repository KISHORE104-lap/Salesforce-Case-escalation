/** Sends a bell + mobile notification to the worker who received the escalation. */
public without sharing class EscalationNotifier {
    public static void notify(List<Case> cases) {
        List<CustomNotificationType> types = [
            SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'Case_Escalated' LIMIT 1
        ];
        if (types.isEmpty()) {
            return;
        }
        for (Case c : cases) {
            if (c.Escalated_To__c == null) {
                continue;
            }
            Messaging.CustomNotification n = new Messaging.CustomNotification();
            n.setNotificationTypeId(types[0].Id);
            n.setTitle('Case ' + c.CaseNumber + ' escalated to you');
            n.setBody(
                EscalationService.levelLabel(EscalationService.levelOf(c)) + ' level · ' +
                c.Priority + ' priority' +
                (String.isBlank(c.Escalation_Reason__c) ? '' : ' · ' + c.Escalation_Reason__c)
            );
            n.setTargetId(c.Id);
            try {
                n.send(new Set<String>{ String.valueOf(c.Escalated_To__c) });
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'Escalation notification failed: ' + e.getMessage());
            }
        }
    }
}
