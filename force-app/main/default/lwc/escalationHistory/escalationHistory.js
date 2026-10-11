import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getEscalationHistory from '@salesforce/apex/CaseController.getEscalationHistory';

const LEVELS = ['Support Agent', 'Team Lead', 'Support Manager', 'Case Admin'];

export default class EscalationHistory extends LightningElement {
    @api recordId;
    entries = [];
    error;
    wiredResult;

    @wire(getEscalationHistory, { caseId: '$recordId' })
    wiredHistory(result) {
        this.wiredResult = result;
        if (result.data) {
            this.entries = result.data.map((log) => ({
                id: log.Id,
                name: log.Name,
                from: LEVELS[log.From_Level__c] || `Level ${log.From_Level__c}`,
                to: LEVELS[log.To_Level__c] || `Level ${log.To_Level__c}`,
                reason: log.Reason__c,
                comments: log.Comments__c,
                at: log.Escalated_At__c,
                by: log.Escalated_By__r ? log.Escalated_By__r.Name : '—',
                toUser: log.Escalated_To__r ? log.Escalated_To__r.Name : 'Queue',
                isAuto: log.Escalation_Type__c === 'Automatic',
                icon: log.Escalation_Type__c === 'Automatic' ? 'utility:clock' : 'utility:user'
            }));
            this.error = undefined;
        } else if (result.error) {
            this.error = result.error?.body?.message || 'Could not load history.';
        }
    }

    get hasEntries() {
        return this.entries.length > 0;
    }

    get title() {
        return `Escalation History (${this.entries.length})`;
    }

    handleRefresh() {
        refreshApex(this.wiredResult);
    }
}
