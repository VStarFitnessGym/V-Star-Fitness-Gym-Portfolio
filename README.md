# V-Star Fitness & Boxing Club

V-Star Fitness & Boxing Club is a gym website and management platform for members and staff. The public website introduces the gym, its training facilities, kickboxing, membership options, opening hours, and contact details. The project also includes staff-facing member and subscription management features.

**Website:** [https://vstarfitness.vercel.app/](https://vstarfitness.vercel.app/)

## About the Gym

V-Star Fitness & Boxing Club is based in Kakinada, Andhra Pradesh. The website highlights strength and cardio training, free weights, and guided kickboxing sessions.

### Membership Plans

| Plan | Duration | Price |
| --- | ---: | ---: |
| 1 Month Standard | 30 days | ₹1,000 |
| 3 Months Quarterly | 90 days | ₹2,500 |
| 6 Months Half-Yearly | 180 days | ₹4,500 |
| Annual Gold VIP | 365 days | ₹9,000 |

All plans list the same standard gym inclusions: access to gym-floor equipment, cardio and strength training areas, a fitness assessment, and access during regular opening hours.

### Opening Hours

Open every day:

- Morning: 5:30 AM–10:00 AM
- Evening: 5:00 PM–9:00 PM

### Contact

- **Address:** 2nd Floor, Opposite Vasavi Kanyaka Temple, Main Road, Kakinada
- **Phone:** 99669 75706
- **Email:** [vstarfitnessgym@gmail.com](mailto:vstarfitnessgym@gmail.com)
- **Instagram:** [@boxer_srinu_kakinada_](https://www.instagram.com/boxer_srinu_kakinada_/)

## Website Features

- Responsive landing page with gym information and navigation
- Training and facilities gallery
- Gym and kickboxing feature sections
- Membership plan pricing and contact links
- Opening hours, location, and contact form
- Mobile-friendly layouts and interactive navigation

## Management Platform

The repository also contains gym-management capabilities for staff, including:

- Member records and dashboard views
- Membership creation, renewal, and subscription history
- Reminder workflows for upcoming and expired memberships
- API, database, and Supabase integration
- Validation and security-focused backend middleware

## Technology

- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL / Supabase
- **Tests:** Node.js, `tsx`, and PGlite

## Run Locally

### Requirements

- Node.js 18 or newer
- npm

### Install and start the website

```bash
npm install
npm run dev
```

Vite prints the local development URL in the terminal.

### Build for production

```bash
npm run build
npm run preview
```

### Run the backend

Configure the required database and service environment variables for your development environment, then start the API:

```bash
npx tsx server/index.ts
```

The backend uses port `3001` by default unless `PORT` is configured.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and build the frontend |
| `npm run preview` | Preview the production build |
| `npm run typecheck:server` | Type-check the backend |
| `npm test` | Run the project test suites |
| `npm run test:db` | Run database tests |
| `npm run test:api` | Run API tests |
| `npm run test:frontend` | Run frontend API-client tests |
| `npm run test:reminder` | Run reminder engine tests |
| `npm run test:provider` | Run messaging provider tests |

## Project Structure

```text
.
├── api/                 # API-related entry points
├── docs/                # Product, architecture, database, and security documentation
├── server/              # Express app, routes, controllers, services, and database code
├── src/
│   ├── assets/           # Logo and website images
│   ├── components/       # Public website and staff dashboard components
│   ├── data/             # Shared plan and development data
│   ├── lib/              # Frontend API client and configuration
│   └── types/            # Frontend TypeScript types
├── supabase/             # Supabase configuration, migrations, and seed data
└── tests/                # API, database, frontend, and reminder tests
```

## Documentation and Security

Technical documentation is available in [`docs/`](./docs/), including the product requirements, system architecture, database design, API design, and test strategy. Security reporting guidance is in [`SECURITY.md`](./SECURITY.md).

## Developer

**Duvvuri Subrahmanya Sri Harsha Sarma**
