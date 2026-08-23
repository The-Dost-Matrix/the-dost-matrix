import { readFileSync } from "node:fs";

import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Server-only Firebase Admin SDK.
 *
 * Ondersteunt:
 * - FIREBASE_SERVICE_ACCOUNT_KEY
 * - FIREBASE_SERVICE_ACCOUNT_FILE
 */

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();

  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_KEY kon niet als JSON worden gelezen.",
      );
    }
  }

  if (filePath) {
    try {
      const fileContents = readFileSync(filePath, "utf8");
      return JSON.parse(fileContents);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Onbekende fout";

      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_FILE kon niet worden gelezen: ${message}`,
      );
    }
  }

  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT_KEY en FIREBASE_SERVICE_ACCOUNT_FILE ontbreken.",
  );
}

function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === "matrix-admin");

  if (existing) {
    return existing;
  }

  return initializeApp(
    {
      credential: cert(loadServiceAccount()),
    },
    "matrix-admin",
  );
}

export const adminAuth = getAuth(getAdminApp());
export const adminDb = getFirestore(getAdminApp());

export async function verifyIdToken(authorizationHeader: string | null) {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new Error("Geen geldig sessietoken meegestuurd.");
  }

  return adminAuth.verifyIdToken(token);
}