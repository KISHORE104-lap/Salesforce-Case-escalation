/**
 * Reads the escalation matrix (Escalation_Policy__mdt) and works out SLA deadlines.
 * Level 1 = Team Lead, Level 2 = Support Manager, Level 3 = Case Admin.
 */
public inherited sharing class EscalationPolicyService {
    private static Map<String, Escalation_Policy__mdt> cache;

    private static String key(String priority, Integer level) {
        return (String.isBlank(priority) ? 'Medium' : priority) + '#' + level;
    }

    public static Map<String, Escalation_Policy__mdt> policies() {
        if (cache == null) {
            cache = new Map<String, Escalation_Policy__mdt>();
            for (Escalation_Policy__mdt p : [
                SELECT DeveloperName, MasterLabel, Priority__c, Level__c, Hours_To_Escalate__c,
                       Target_Role__c, Target_Queue__c
                FROM Escalation_Policy__mdt
                WHERE Active__c = true
            ]) {
                if (p.Level__c != null) {
                    cache.put(key(p.Priority__c, p.Level__c.intValue()), p);
                }
            }
        }
        return cache;
    }

    /** Policy for moving a case of this priority INTO the given level (falls back to Medium). */
    public static Escalation_Policy__mdt getPolicy(String priority, Integer level) {
        Escalation_Policy__mdt p = policies().get(key(priority, level));
        if (p == null) {
            p = policies().get(key('Medium', level));
        }
        return p;
    }

    /** Deadline for a case sitting at currentLevel before it should move to currentLevel + 1. */
    public static Datetime nextDeadline(String priority, Integer currentLevel, Datetime fromTime) {
        Escalation_Policy__mdt next = getPolicy(priority, currentLevel + 1);
        if (next == null || next.Hours_To_Escalate__c == null || fromTime == null) {
            return null;
        }
        Integer minutes = (next.Hours_To_Escalate__c * 60).intValue();
        return fromTime.addMinutes(minutes);
    }

    public static List<Escalation_Policy__mdt> getAll() {
        return [
            SELECT DeveloperName, MasterLabel, Priority__c, Level__c, Hours_To_Escalate__c,
                   Target_Role__c, Target_Queue__c, Active__c
            FROM Escalation_Policy__mdt
            ORDER BY Priority__c, Level__c
        ];
    }
}
