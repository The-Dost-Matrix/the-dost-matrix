import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { advanceMissionsForOwner } from "@/core/mission-engine/v2/autonomous-advance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Hobby-functies mogen (net als Pro/Enterprise standaard) hooguit
 * 300 seconden lopen — dat is zowel de standaardwaarde als het maximum op
 * Hobby (zie https://vercel.com/docs/functions/configuring-functions/duration).
 * Expliciet vastleggen op het maximum in plaats van op de standaardwaarde te
 * vertrouwen, zodat een latere upgrade naar Pro (max 800s, of 1800s in bèta)
 * dit bestand niet per ongeluk stil laat teruggaan naar een lagere impliciete
 * standaard.
 */
export const maxDuration = 300;

/**
 * Roadmap-stap 15 (deel 2) — autonome missie-triggers.
 *
 * Deze route bestaat om missies te laten doorlopen ZONDER dat Elroy is
 * ingelogd — dus zonder Firebase ID-token, in tegenstelling tot elke andere
 * route onder /api/missions/v2. Bedoeld om periodiek aangeroepen te worden
 * door een externe klok (de GitHub Actions-workflow
 * .github/workflows/advance-missions.yml, elke ~10 minuten — gekozen boven
 * een Vercel Pro-upgrade omdat Vercel's ingebouwde cron op het gratis
 * Hobby-plan maar één keer per dag draait, met tot 59 minuten afwijking, wat
 * te grof is om een missie 's nachts in meerdere stappen te laten
 * voortgaan).
 *
 * Authenticatie is daarom bewust anders dan de rest van de app: een gedeeld
 * geheim (MISSION_ADVANCE_SECRET) in de Authorization-header, vergeleken met
 * timingSafeEqual om te voorkomen dat een aanvaller het geheim via kleine
 * verschillen in antwoordtijd zou kunnen raden. Dit is uitsluitend bedoeld
 * voor de eigen GitHub Actions-workflow, nooit voor een ingelogde gebruiker.
 *
 * Dit systeem heeft één eigenaar (Elroy) — er is dus geen "voor wie moet dit
 * draaien"-vraag zoals bij een multi-tenant systeem. MISSION_ADVANCE_OWNER_ID
 * bevat zijn Firebase-UID (te vinden via Firebase Console → Authentication →
 * Users), zodat deze route weet van wie de missies zijn zonder dat er een
 * ingelogde sessie is om dat uit af te leiden.
 *
 * Mag pas automatisch mergen omdat findHardEscalationReason() en
 * reviewPullRequestForAutomatedSignoff() (zie automated-signoff.ts en
 * risk-classification.ts) dat al vóór deze route bestonden — dit is Elroy's
 * expliciete delegatie van "needs-signoff" aan mij, vastgelegd in
 * docs/roadmap.md onder de herziening van 12 september 2026.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // timingSafeEqual gooit een fout bij ongelijke lengtes in plaats van false
  // terug te geven — een lengteverschil lekt in dat geval alsnog (heel
  // beperkte) timinginformatie, maar dat is onvermijdelijk zonder de
  // werkelijke geheimlengte te verbergen; voor een periodieke, niet
  // publiek-aangekondigde interne aanroep is dit een acceptabel compromis.
  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.MISSION_ADVANCE_SECRET;

  if (!expectedSecret) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return false;
  }

  return timingSafeEqualStrings(token, expectedSecret);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
  }

  const ownerId = process.env.MISSION_ADVANCE_OWNER_ID;

  if (!ownerId) {
    return NextResponse.json(
      { error: "MISSION_ADVANCE_OWNER_ID ontbreekt in de omgevingsvariabelen." },
      { status: 500 },
    );
  }

  // Laat ruim voor de daadwerkelijke 300s-limiet van Vercel stoppen met het
  // starten van NIEUWE stappen, zodat er nog tijd overblijft om de lopende
  // stap af te ronden en een nette JSON-response te sturen in plaats van dat
  // Vercel de hele functie hard afbreekt.
  const deadlineAt = Date.now() + 260_000;

  try {
    const result = await advanceMissionsForOwner(ownerId, { deadlineAt });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Autonome missie-voortgang mislukt", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Er is iets misgegaan bij het autonoom doorvoeren van missies.",
      },
      { status: 500 },
    );
  }
}
