# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in FloCafe, please report it responsibly. **Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

Email **support@flopos.com** (or open a private vulnerability report via [GitHub's advisory feature](https://github.com/FreeOpenSourcePOS/FloCafe/security/advisories/new)).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 1 week
- **Fix or mitigation** for confirmed vulnerabilities, coordinated with you for disclosure

## Scope

FloCafe handles:
- User authentication (JWT tokens, bcrypt password hashing)
- Payment processing (bill generation, tax calculations)
- Local data storage (SQLite database)
- Thermal printing (potential injection via print commands)

All of these are in scope for security reports.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.7.x   | Yes       |
| < 1.7   | No        |

## Security Best Practices for Deployment

- Change the default admin credentials (`admin@flo.local` / `admin123`) immediately after first run
- Set a strong `JWT_SECRET` in your `.env` file (or let the app generate one on first launch)
- Keep the application updated to the latest version
- FloCafe runs locally — do not expose port 3001 (API) or 3002 (dev) to the public internet
