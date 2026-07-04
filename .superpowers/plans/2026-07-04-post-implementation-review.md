# Post-Implementation Review Plan

**Date:** 2026-07-04
**Scope:** Security audit, code review, and vulnerability scan for all new features

## Background

7 features were implemented across FloCafe (backend) and FloUI (frontend):
1. Cancel order with status-based rules
2. Loyalty points toggle
3. Discount system (order + item level)
4. Extra notes with character limits
5. Receipt reprinting with print logging
6. Override PIN validation
7. Add-on items after order placement

**Problem:** No dedicated review agents were spawned during implementation. Need to catch security issues, code quality problems, and vulnerabilities before shipping.

## Review Plan (3 Parallel Agents)

### Agent 1: Security Audit (`/cso`)

**Focus areas:**
- Override PIN validation (bcrypt comparison, timing attacks)
- Auth bypass on new endpoints
- SQL injection in discount/loyalty queries
- Input validation gaps (negative values, overflow)
- Rate limiting on PIN attempts
- Session/token handling in new flows

**Files to audit:**
- `main/routes/orders.ts` — discount, loyalty, cancel endpoints
- `main/routes/bills.ts` — print endpoints
- `main/services/receipt.ts` — print service
- `main/db.ts` — new migrations

**Expected output:**
- List of findings with severity (CRITICAL/HIGH/MEDIUM/LOW)
- Remediation recommendations
- Go/no-go for shipping

### Agent 2: Code Review (`/review`)

**Focus areas:**
- Code quality and consistency
- Error handling completeness
- DRY violations
- Type safety
- Test coverage gaps
- API design consistency

**Files to review:**
- All modified files in FloCafe repo (backend)
- All modified files in FloUI repo (frontend)
- Test files

**Expected output:**
- List of issues by severity
- Suggested refactors
- Code quality score

### Agent 3: Vulnerability Scan (`/vulnerability-scan`)

**Focus areas:**
- Dependency vulnerabilities (npm audit)
- Known CVEs in dependencies
- Outdated packages with security issues
- Transitive dependency risks

**Scope:**
- `package.json` dependencies
- Frontend `package.json` dependencies
- Lock file analysis

**Expected output:**
- List of vulnerable dependencies
- Severity ratings
- Upgrade recommendations

## Execution Plan

All 3 agents run in parallel. Results are collected and synthesized into a final report.

### Phase 1: Launch (parallel)
```
┌─────────────────┐
│ Security Audit  │ ← Agent 1
└─────────────────┘
┌─────────────────┐
│  Code Review    │ ← Agent 2
└─────────────────┘
┌─────────────────┐
│ Vuln Scan       │ ← Agent 3
└─────────────────┘
```

### Phase 2: Synthesis
- Merge findings from all 3 agents
- Deduplicate overlapping issues
- Prioritize by severity
- Create remediation plan

### Phase 3: Report
- Final report with all findings
- Recommended fixes
- Ship readiness assessment

## Success Criteria

- [ ] All new endpoints reviewed for security
- [ ] All code changes reviewed for quality
- [ ] All dependencies scanned for vulnerabilities
- [ ] No CRITICAL issues blocking ship
- [ ] Remediation plan for HIGH issues

## Timeline

- Phase 1: ~5 minutes (parallel execution)
- Phase 2: ~2 minutes (synthesis)
- Phase 3: ~1 minute (report)
- **Total: ~8 minutes**
