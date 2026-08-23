# The Dost Matrix v0.4.0 — Knowledge Foundation

Deze versie is rechtstreeks opgebouwd vanuit v0.3.1-hardened.

## Installatie
1. Kopieer je werkende `.env.local` uit v0.3.1 naar deze map.
2. Voer uit: `npm install`, `npm run typecheck`, `npm run lint`, `npm run build`.
3. Start met `npm run dev`.
4. Open `http://localhost:3000/dashboard/knowledge`.

## Werking
- Upload een Markdown-bestand.
- De server gebruikt de ingestelde LLM-provider om gestructureerde kennisvoorstellen te maken.
- Voorstellen krijgen status `pending`.
- Alleen `approved` items worden door de Director opgehaald.
- Chatgesprekken worden niet meer automatisch als kennis opgeslagen.

## Veiligheid
- API-routes verifiëren het Firebase ID-token.
- Alle Firestore-schrijfacties lopen via Firebase Admin.
- De browser kan alleen eigen kennis lezen.
