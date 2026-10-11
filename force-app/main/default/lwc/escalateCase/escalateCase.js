import { LightningElement, api } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import getEscalationPreview from '@salesforce/apex/CaseController.getEscalationPreview';
import escalateCase from '@salesforce/apex/CaseController.escalateCase';

const REASONS = ['Customer Request', 'Agent Request', 'Technical Complexity', 'Priority Change', 'SLA Breach'];

export default class EscalateCase extends LightningElement {
    _recordId;
    preview;
    reason;
    comments = '';
    error;
    isLoading = true;
    isSaving = false;

    reasonOptions = REASONS.map((r) => ({ label: r, value: r }));

    @api
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        this._recordId = value;
        if (value) {
            this.loadPreview();
        }
    }

    async loadPreview() {
        this.isLoading = true;
        try {
            this.preview = await getEscalationPreview({ caseId: this._recordId });
            this.error = undefined;
        } catch (e) {
            this.error = e?.body?.message || 'Could not load case details.';
        } finally {
            this.isLoading = false;
        }
    }

    get blockedMessage() {
        if (!this.preview) return null;
        if (!this.preview.canEscalate) return 'Your profile does not allow escalating cases.';
        if (this.preview.isClosed) return 'This case is closed. Reopen it before escalating.';
        if (this.preview.isMaxLevel) return 'This case is already with the Case Admin, the highest level.';
        return null;
    }

    get canSubmit() {
        return this.preview && !this.blockedMessage;
    }

    get submitDisabled() {
        return !this.canSubmit || !this.reason || this.isSaving;
    }

    handleReason(event) {
        this.reason = event.detail.value;
    }

    handleComments(event) {
        this.comments = event.detail.value;
    }

    handleCancel() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }

    async handleSubmit() {
        this.isSaving = true;
        try {
            const res = await escalateCase({ caseId: this._recordId, reason: this.reason, comments: this.comments });
            const who = res.escalatedToName ? ` (${res.escalatedToName})` : ' queue';
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Case escalated',
                    message: `Case ${this.preview.caseNumber} is now with the ${res.levelLabel}${who}.`,
                    variant: 'success'
                })
            );
            await notifyRecordUpdateAvailable([{ recordId: this._recordId }]);
            this.dispatchEvent(new CloseActionScreenEvent());
        } catch (e) {
            this.error = e?.body?.message || 'Escalation failed.';
        } finally {
            this.isSaving = false;
        }
    }
}
