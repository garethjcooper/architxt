# architxt UI

**Shadcn/ui-based frontend for architxt document processing**

100% decoupled HTTP client to Express backend.

## Quick Start

```bash
cd ui
npm install
npm run dev
```

The UI runs on `http://localhost:3000`

Point to backend by setting `NEXT_PUBLIC_API_URL` in `.env.local`.

## Architecture

```
ui/
├── app/              # Next.js App Router pages
├── components/ui/    # shadcn components (29 components)
├── lib/
│   ├── api/          # HTTP client layer (100% decoupled)
│   └── utils.ts      # cn() utility
└── hooks/            # useApi hook
```

## Implemented

- Document list with status filtering
- Document detail view with tabs
- Upload dialog (drag & drop)
- Delete workflow
- Claim/Mark Ready actions
- Error handling with Sonner toasts
- Sidebar navigation shell
- Skeleton loading states

## API Endpoints Used

```
GET    /documents
GET    /documents/:id
POST   /documents (multipart/form-data)
PUT    /documents/:id
DELETE /documents/:id
POST   /documents/:id/claim
POST   /documents/:id/ready
GET    /documents/:id/tags
GET    /documents/:id/metadata
```

## Style System

- Based on Hindsight patterns
- OKLCH color system
- Subtle card shadows with ring borders
- Consistent focus states
