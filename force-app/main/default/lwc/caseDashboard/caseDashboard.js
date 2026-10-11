import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getUserContext from '@salesforce/apex/CaseController.getUserContext';
import getDashboardStats from '@salesforce/apex/CaseController.getDashboardStats';
import getCases from '@salesforce/apex/CaseController.getCases';
import getPolicies from '@salesforce/apex/CaseController.getPolicies';

const SLA_CLASS = {
    Breached: 'slds-text-color_error slds-text-title_bold',
    'At Risk': 'sla-at-risk',
    'On Track': 'slds-text-color_success',
    Met: 'slds-text-color_success',
    Missed: 'slds-text-color_error'
};

const COLUMNS = [
    {
        label: 'Case',
        fieldName: 'recordUrl',
        type: 'url',
        initialWidth: 110,
        typeAttributes: { label: { fieldName: 'caseNumber' }, target: '_self' }
    },
    { label: 'Subject', fieldName: 'subject', wrapText: true },
    { label: 'Priority', fieldName: 'priority', initialWidth: 95 },
    { label: 'Status', fieldName: 'status', initialWidth: 100 },
    { label: 'Level', fieldName: 'levelLabel', initialWidth: 140 },
    {
        label: 'SLA',
        fieldName: 'slaStatus',
        initialWidth: 100,
        cellAttributes: { class: { fieldName: 'slaClass' } }
    },
    {
        label: 'SLA Due',
        fieldName: 'slaDue',
        type: 'date',
        initialWidth: 150,
        typeAttributes: { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    },
    { label: 'Owner', fieldName: 'ownerName', initialWidth: 140 }
];

const POLICY_COLUMNS = [
    { label: 'Priority', fieldName: 'Priority__c' },
    { label: 'Level', fieldName: 'Level__c', type: 'number', initialWidth: 80 },
    { label: 'Hours allowed', fieldName: 'Hours_To_Escalate__c', type: 'number' },
    { label: 'Target role', fieldName: 'Target_Role__c' },
    { label: 'Fallback queue', fieldName: 'Target_Queue__c' }
];

export default class CaseDashboard extends NavigationMixin(LightningElement) {
    columns = COLUMNS;
    policyColumns = POLICY_COLUMNS;
    filter = 'MINE';
    context;
    stats;
    cases = [];
    policies = [];
    error;
    isLoading = true;

    wiredStatsResult;
    wiredCasesResult;

    @wire(getUserContext)
    wiredContext({ data, error }) {
        if (data) {
            this.context = data;
            if (data.canViewTeam && this.filter === 'MINE' && data.roleDeveloperName !== 'Support_Agent') {
                this.filter = 'ESCALATED_TO_ME';
            }
        } else if (error) {
            this.error = this.reduceError(error);
        }
    }

    @wire(getDashboardStats)
    wiredStats(result) {
        this.wiredStatsResult = result;
        if (result.data) {
            this.stats = result.data;
        } else if (result.error) {
            this.error = this.reduceError(result.error);
        }
    }

    @wire(getCases, { filter: '$filter' })
    wiredCases(result) {
        this.wiredCasesResult = result;
        this.isLoading = false;
        if (result.data) {
            this.cases = result.data.map((row) => ({
                ...row,
                recordUrl: `/lightning/r/Case/${row.id}/view`,
                slaClass: SLA_CLASS[row.slaStatus] || ''
            }));
            this.error = undefined;
        } else if (result.error) {
            this.cases = [];
            this.error = this.reduceError(result.error);
        }
    }

    @wire(getPolicies)
    wiredPolicies({ data }) {
        if (data) {
            this.policies = data;
        }
    }

    get greeting() {
        if (!this.context) return 'Case Dashboard';
        const role = this.context.roleName ? ` · ${this.context.roleName}` : '';
        return `Welcome, ${this.context.userName}${role}`;
    }

    get filterOptions() {
        const opts = [
            { label: 'My open cases', value: 'MINE' },
            { label: 'Escalated to me', value: 'ESCALATED_TO_ME' }
        ];
        if (this.context && this.context.canViewTeam) {
            opts.push({ label: 'Team cases', value: 'TEAM' });
            opts.push({ label: 'SLA breached', value: 'BREACHED' });
        }
        opts.push({ label: 'Recently closed', value: 'CLOSED' });
        return opts.map((o) => ({ ...o, variant: o.value === this.filter ? 'brand' : 'neutral' }));
    }

    get tiles() {
        const s = this.stats || {};
        return [
            { key: 'open', label: 'Open cases', value: s.open ?? '–', css: 'tile' },
            { key: 'esc', label: 'Escalated', value: s.escalated ?? '–', css: 'tile tile-warn' },
            { key: 'me', label: 'Escalated to me', value: s.escalatedToMe ?? '–', css: 'tile tile-info' },
            { key: 'breach', label: 'SLA breached', value: s.breached ?? '–', css: 'tile tile-error' },
            { key: 'closed', label: 'Closed today', value: s.closedToday ?? '–', css: 'tile tile-success' }
        ];
    }

    get priorityBars() {
        const s = this.stats || {};
        const total = Math.max(1, (s.high || 0) + (s.medium || 0) + (s.low || 0));
        return [
            { key: 'High', value: s.high || 0, css: 'bar bar-high' },
            { key: 'Medium', value: s.medium || 0, css: 'bar bar-medium' },
            { key: 'Low', value: s.low || 0, css: 'bar bar-low' }
        ].map((b) => ({ ...b, style: `width:${Math.round((b.value / total) * 100)}%` }));
    }

    get hasCases() {
        return this.cases && this.cases.length > 0;
    }

    get showPolicies() {
        return this.context && this.context.canManagePolicy && this.policies.length > 0;
    }

    handleFilter(event) {
        this.isLoading = true;
        this.filter = event.currentTarget.dataset.value;
    }

    handleNewCase() {
        this[NavigationMixin.Navigate]({
            type: 'standard__objectPage',
            attributes: { objectApiName: 'Case', actionName: 'new' }
        });
    }

    async handleRefresh() {
        this.isLoading = true;
        await Promise.all([refreshApex(this.wiredStatsResult), refreshApex(this.wiredCasesResult)]);
        this.isLoading = false;
    }

    reduceError(error) {
        if (Array.isArray(error?.body)) return error.body.map((e) => e.message).join(', ');
        return error?.body?.message || error?.message || 'Unknown error';
    }
}
