// Runs the SLA escalation batch once, immediately (useful for demos).
Database.executeBatch(new CaseEscalationBatch(), 50);
