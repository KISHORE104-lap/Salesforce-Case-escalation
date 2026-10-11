#!/usr/bin/env bash
# One-shot setup of CaseFlow in a new scratch org.
# Needs: Salesforce CLI (sf) and a Dev Hub you are logged into (sf org login web --set-default-dev-hub).
set -euo pipefail
ALIAS=${1:-caseflow}
# Usernames must be unique across all Salesforce orgs, so add a suffix
SUFFIX=$(date +%s)

sf org create scratch --definition-file config/project-scratch-def.json --alias "$ALIAS" --duration-days 30 --set-default
sf project deploy start --source-dir force-app --target-org "$ALIAS"
sf project deploy start --source-dir force-app-profiles --target-org "$ALIAS"
sf org assign permset --name CaseFlow_Case_Admin --target-org "$ALIAS"

for u in agent lead mgr cadmin; do
  sf org create user --definition-file "config/users/$u-user-def.json" --target-org "$ALIAS" \
    Username="$u.$SUFFIX@caseflow.dev" || echo "Could not create $u (check available licences)"
done

sf apex run --file scripts/apex/assign-roles.apex --target-org "$ALIAS"
sf apex run --file scripts/apex/seed-data.apex --target-org "$ALIAS"
sf apex run --file scripts/apex/schedule-escalation.apex --target-org "$ALIAS"
sf apex run test --test-level RunLocalTests --code-coverage --result-format human --wait 20 --target-org "$ALIAS"
sf org open --target-org "$ALIAS" --path lightning/n/Case_Dashboard
