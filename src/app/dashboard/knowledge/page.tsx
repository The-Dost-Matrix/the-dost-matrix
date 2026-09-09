"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/domains/auth/auth-provider";
import {
  subscribeToKnowledge,
  subscribeToKnowledgeByStatus,
} from "@/domains/knowledge/knowledge-service";
import type {
  KnowledgeEntry,
  KnowledgeStatus,
} from "@/core/domain/knowledge/knowledge-entry";

const knowledgeTypePresentation: Record<string, { icon: string; label: string }> = {
  vision: { icon: "🔭", label: "Visie" },
  goal: { icon: "🎯", label: "Doel" },
  decision: { icon: "⚖️", label: "Beslissing" },
  architecture: { icon: "🏗️", label: "Architectuur" },
  project: { icon: "📁", label: "Project" },
  process: { icon: "⚙️", label: "Proces" },
  preference: { icon: "⭐", label: "Voorkeur" },
  lesson: { icon: "💡", label: "Les" },
  task: { icon: "✅", label: "Taak" },
  risk: { icon: "⚠️", label: "Risico" },
  open_question: { icon: "❓", label: "Open vraag" },
  person: { icon: "👤", label: "Persoon" },
  company: { icon: "🏢", label: "Bedrijf" },
  fact: { icon: "📌", label: "Feit" },
  legacydocument: { icon: "📄", label: "Document" },
};

export default function KnowledgePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [pendingEntries, setPendingEntries] = useState<KnowledgeEntry[]>([]);
  const [rejectedEntries, setRejectedEntries] = useState<KnowledgeEntry[]>([]);
  const [showRejected, setShowRejected] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [chatContent, setChatContent] = useState("");
const [chatImporting, setChatImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editType, setEditType] = useState<KnowledgeEntry["type"]>("fact");
  const [editProject, setEditProject] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [bulkReviewing, setBulkReviewing] = useState(false);
const [bulkProgress, setBulkProgress] = useState({
  completed: 0,
  total: 0,
});

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;

    return subscribeToKnowledge(
      user.uid,
      setEntries,
      (caught) => setError(caught.message),
      250,
    );
  }, [user]);

  // Restpunt (7 september 2026): wachtend en afgewezen komen nu allebei uit
  // hun eigen, statusgefilterde query in plaats van client-side gefilterd te
  // worden uit de (op 250 begrensde) algemene lijst hierboven — zie de
  // toelichting bij subscribeToKnowledgeByStatus. Zo kan de groei van
  // goedgekeurde items de wachtrij nooit meer verdringen.
  useEffect(() => {
    if (!user) return;

    return subscribeToKnowledgeByStatus(
      user.uid,
      "pending",
      setPendingEntries,
      (caught) => setError(caught.message),
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;

    return subscribeToKnowledgeByStatus(
      user.uid,
      "rejected",
      setRejectedEntries,
      (caught) => setError(caught.message),
    );
  }, [user]);

  const pending = pendingEntries;

  const approved = useMemo(
    () => entries.filter((entry) => !entry.status || entry.status === "approved"),
    [entries],
  );

  function selectFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    setFiles(
      event.target.files
        ? Array.from(event.target.files)
        : [],
    );
  
    setMessage("");
    setError("");
  }

  function startEditing(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setEditTitle(entry.title ?? "");
    setEditContent(entry.content);
    setEditType(entry.type ?? "fact");
    setEditProject(entry.project ?? "");
    setEditTags(entry.tags.join(", "));
    setError("");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
    setEditType("fact");
    setEditProject("");
    setEditTags("");
  }

  async function saveEditing(id: string) {
    if (!user || saving) return;

    setSaving(true);
    setError("");

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/knowledge/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id,
          title: editTitle,
          content: editContent,
          type: editType,
          project: editProject,
          tags: editTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Opslaan is mislukt.");
      }

      cancelEditing();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Opslaan is mislukt.");
    } finally {
      setSaving(false);
    }
  }
  async function importFile() {
    if (!user || files.length === 0 || busy) {
      return;
    }
  
    setBusy(true);
    setError("");
    setMessage("");
  
    try {
      const token = await user.getIdToken();
  
      let totalImported = 0;
      let registeredDocuments = 0;
  
      for (
        let index = 0;
        index < files.length;
        index += 1
      ) {
        const currentFile = files[index];
        const lowerFileName =
          currentFile.name.toLowerCase();
  
        setMessage(
          `Bestand ${index + 1} van ${files.length} wordt geïmporteerd: ${currentFile.name}`,
        );
  
        const mimeType =
          currentFile.type ||
          (lowerFileName.endsWith(".md")
            ? "text/markdown"
            : lowerFileName.endsWith(".pdf")
              ? "application/pdf"
              : lowerFileName.endsWith(".docx")
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : lowerFileName.endsWith(".xlsx")
                  ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  : lowerFileName.endsWith(".jpg") ||
                      lowerFileName.endsWith(".jpeg")
                    ? "image/jpeg"
                    : lowerFileName.endsWith(".png")
                      ? "image/png"
                      : "application/octet-stream");
  
        const isMarkdown =
          lowerFileName.endsWith(".md") ||
          mimeType === "text/markdown" ||
          mimeType === "text/plain";
  
        const content = isMarkdown
          ? await currentFile.text()
          : "";
  
        const documentResponse = await fetch(
          "/api/documents/upload",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              fileName: currentFile.name,
              mimeType,
              fileSize: currentFile.size,
              content,
            }),
          },
        );
  
        const documentResult =
          await documentResponse.json();
  
        if (!documentResponse.ok) {
          throw new Error(
            documentResult.error ??
              `Document "${currentFile.name}" registreren is mislukt.`,
          );
        }
  
        registeredDocuments += 1;
  
        if (!isMarkdown) {
          continue;
        }
  
        const knowledgeResponse = await fetch(
          "/api/knowledge/import",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              filename: currentFile.name,
              content,
              documentId:
                documentResult.document.id,
            }),
          },
        );
  
        const knowledgeResult =
          await knowledgeResponse.json();
  
          if (!knowledgeResponse.ok) {
            const importError =
              typeof knowledgeResult.error === "string"
                ? knowledgeResult.error
                : "";
          
            const hasNoKnowledge =
              importError.includes(
                "geen duurzame technische kennis gevonden",
              );
          
            if (hasNoKnowledge) {
              continue;
            }
          
            throw new Error(
              importError ||
                `Kennisextractie van "${currentFile.name}" is mislukt.`,
            );
          }
          
          totalImported +=
            knowledgeResult.imported ?? 0;
      }
  
      setMessage(
        `${registeredDocuments} bestanden zijn verwerkt. ${totalImported} kennisitems staan klaar voor beoordeling.`,
      );
  
      setFiles([]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Importeren is mislukt.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function archiveFile() {
    const currentFile = files[0];
  
    if (
      !user ||
      !currentFile ||
      files.length !== 1 ||
      busy
    ) {
      return;
    }
  
    setBusy(true);
    setError("");
    setMessage("");
  
    try {
      const lowerFileName =
        currentFile.name.toLowerCase();
  
      if (!lowerFileName.endsWith(".md")) {
        throw new Error(
          "Conversation Archive accepteert alleen .md-bestanden.",
        );
      }
  
      const content =
        await currentFile.text();
  
      if (!content.trim()) {
        throw new Error(
          "Het Markdown-bestand is leeg.",
        );
      }
  
      const token = await user.getIdToken();
  
      const response = await fetch(
        "/api/conversations/archive",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            filename: currentFile.name,
            content,
          }),
        },
      );
  
      const result = (await response.json()) as {
        id?: string;
        archived?: boolean;
        error?: string;
      };
  
      if (!response.ok) {
        throw new Error(
          result.error ??
            "Conversatie archiveren is mislukt.",
        );
      }
  
      setMessage(
        `Conversatie "${currentFile.name}" is volledig opgeslagen zonder analyse.`,
      );
  
      setFiles([]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Conversatie archiveren is mislukt.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importChat() {
    if (!user || !chatContent.trim() || chatImporting) {
      return;
    }
  
    setChatImporting(true);
    setError("");
    setMessage("");
  
    try {
      const token = await user.getIdToken();
      const source = chatContent.trim();
      const maxChunkLength = 80_000;
      const chunks: string[] = [];
  
      let remaining = source;
  
      while (remaining.length > maxChunkLength) {
        let splitAt = remaining.lastIndexOf(
          "\n",
          maxChunkLength,
        );
  
        if (splitAt < maxChunkLength * 0.6) {
          splitAt = maxChunkLength;
        }
  
        chunks.push(
          remaining.slice(0, splitAt).trim(),
        );
  
        remaining = remaining.slice(splitAt).trim();
      }
  
      if (remaining) {
        chunks.push(remaining);
      }
  
      const importDate = new Date().toISOString();
      let totalImported = 0;
  
      for (let index = 0; index < chunks.length; index += 1) {
        setMessage(
          `Chatdeel ${index + 1} van ${chunks.length} wordt geanalyseerd...`,
        );
  
        const response = await fetch("/api/knowledge/import", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            filename:
              `Chat ${importDate} deel ${index + 1} van ${chunks.length}.md`,
            content: chunks[index],
          }),
        });
  
        const result = (await response.json()) as {
          imported?: number;
          error?: string;
        };
  
        if (!response.ok) {
          throw new Error(
            result.error ??
              `Chatdeel ${index + 1} kon niet worden geïmporteerd.`,
          );
        }
  
        totalImported += result.imported ?? 0;
      }
  
      setMessage(
        `${totalImported} kennisitems zijn uit ${chunks.length} chatdeel${
          chunks.length === 1 ? "" : "en"
        } aangemaakt.`,
      );
  
      setChatContent("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Chat importeren is mislukt.",
      );
    } finally {
      setChatImporting(false);
    }
  }
  async function requestAiReview(id: string) {
    if (!user || reviewingId) return;

    setReviewingId(id);
    setError("");

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/knowledge/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id, action: "ai_review" }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "AI-review is mislukt.");
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "AI-review is mislukt.",
      );
    } finally {
      setReviewingId(null);
    }
  }
  async function requestBulkAiReview() {
    if (!user || bulkReviewing) return;
  
    const itemsToReview = pending.filter((entry) => !entry.review);
  
    if (itemsToReview.length === 0) {
      setMessage("Alle kennisitems zijn al door de AI beoordeeld.");
      return;
    }
  
    setBulkReviewing(true);
    setBulkProgress({
      completed: 0,
      total: itemsToReview.length,
    });
    setError("");
    setMessage("");
  
    try {
      const token = await user.getIdToken();
  
      for (let index = 0; index < itemsToReview.length; index += 1) {
        const entry = itemsToReview[index];
  
        const response = await fetch("/api/knowledge/review", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: entry.id,
            action: "ai_review",
          }),
        });
  
        const data = (await response.json()) as { error?: string };
  
        if (!response.ok) {
          throw new Error(
            data.error ||
              `AI-review is mislukt bij "${entry.title || "kennisitem"}".`,
          );
        }
  
        setBulkProgress({
          completed: index + 1,
          total: itemsToReview.length,
        });
      }
  
      setMessage(
        `${itemsToReview.length} kennisitems zijn door de AI beoordeeld.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Bulk AI-review is mislukt.",
      );
    } finally {
      setBulkReviewing(false);
    }
  }
  async function applyReviewSuggestion(
    entry: KnowledgeEntry,
  ): Promise<boolean> {
    if (!user || !entry.review) {
      return false;
    }
  
    const { suggestedTitle, suggestedContent } = entry.review;
  
    if (!suggestedTitle || !suggestedContent) {
      setError("De AI-review bevat geen volledig wijzigingsvoorstel.");
      return false;
    }
  
    setApplyingId(entry.id);
    setError("");
  
    try {
      const token = await user.getIdToken();
  
      const response = await fetch("/api/knowledge/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: entry.id,
          title: suggestedTitle,
          content: suggestedContent,
        }),
      });
  
      const data = (await response.json()) as { error?: string };
  
      if (!response.ok) {
        throw new Error(data.error || "AI-voorstel toepassen is mislukt.");
      }
  
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "AI-voorstel toepassen is mislukt.",
      );
  
      return false;
    } finally {
      setApplyingId(null);
    }
  }
  
  async function applyAllReviewSuggestions() {
    if (!user || bulkApplying) {
      return;
    }
  
    const items = pending.filter((entry) => entry.review);
  
    if (items.length === 0) {
      setMessage("Er zijn geen AI-adviezen om toe te passen.");
      return;
    }
  
    setBulkApplying(true);
    setError("");
    setMessage("");
  
    try {
      for (const entry of items) {
        const recommendation = entry.review?.recommendation;
  
        if (recommendation === "approve") {
          const approvedSuccessfully = await review(entry.id, "approved");
  
          if (!approvedSuccessfully) {
            throw new Error(
              `"${entry.title || "Kennisitem"}" kon niet worden goedgekeurd.`,
            );
          }
  
          continue;
        }
  
        if (recommendation === "reject") {
          const rejectedSuccessfully = await review(entry.id, "rejected");
  
          if (!rejectedSuccessfully) {
            throw new Error(
              `"${entry.title || "Kennisitem"}" kon niet worden afgewezen.`,
            );
          }
  
          continue;
        }
  
        if (recommendation === "edit") {
          const appliedSuccessfully = await applyReviewSuggestion(entry);
  
          if (!appliedSuccessfully) {
            throw new Error(
              `Het AI-voorstel voor "${entry.title || "kennisitem"}" kon niet worden toegepast.`,
            );
          }
  
          const approvedSuccessfully = await review(entry.id, "approved");
  
          if (!approvedSuccessfully) {
            throw new Error(
              `Het aangepaste kennisitem "${entry.title || "kennisitem"}" kon niet worden goedgekeurd.`,
            );
          }
        }
      }
  
      setMessage(`${items.length} AI-adviezen zijn succesvol toegepast.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Niet alle AI-adviezen konden worden toegepast.",
      );
    } finally {
      setBulkApplying(false);
    }
  }
  
  async function review(
    id: string,
    status: KnowledgeStatus,
  ): Promise<boolean> {
    if (!user) {
      return false;
    }
  
    setError("");
  
    try {
      const token = await user.getIdToken();
  
      const response = await fetch("/api/knowledge/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id,
          status,
        }),
      });
  
      const data = (await response.json()) as { error?: string };
  
      if (!response.ok) {
        throw new Error(data.error || "Review mislukt.");
      }
  
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review mislukt.");
      return false;
    }
  }

  // Restpunt (7 september 2026): een afgewezen kennisitem was alleen via de
  // Firebase-console terug te vinden, laat staan terug te draaien — na een
  // bulkactie op tientallen items geen prettige eigenschap. Zet het item
  // terug op "pending" via hetzelfde review-endpoint (nu met "pending" in
  // allowedStatuses, zie route.ts) zodat het weer gewoon in de Approval
  // Queue verschijnt.
  async function restoreToPending(id: string) {
    if (restoringId) return;

    setRestoringId(id);
    await review(id, "pending");
    setRestoringId(null);
  }

  if (loading || !user) {
    return (
      <main className="center-screen">
        Knowledge Foundation wordt geladen...
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">THE DOST MATRIX · v0.4.0</p>
          <h1>Knowledge Foundation</h1>
        </div>

        <div className="top-actions">
          {/*
            Hier stond ook een knop "Chat" naar /dashboard/chat. Die pagina
            was een oude kopie van het hele Command Center, inclusief een
            tweede, gekopieerd chatpaneel en het inmiddels vervangen
            missiemodel. De chat woont nu op het Command Center zelf, dus die
            pagina is verwijderd en deze knop zou naar dezelfde plek wijzen
            als "Dashboard" hiernaast.
          */}
          <button
            className="secondary"
            onClick={() => router.push("/dashboard")}
          >
            Dashboard
          </button>
        </div>
      </header>

      <section className="panel knowledge-import">
        <div>
          <p className="eyebrow">MARKDOWN IMPORT</p>
          <h2>Voed het Second Brain met echte kennis</h2>
          <p className="muted">
            Selecteer een bestand. De AI maakt gestructureerde voorstellen;
            pas na jouw goedkeuring gebruikt de Director ze.
          </p>
        </div>

        <div className="stack">
        <input
  type="file"
  multiple
  accept="
    .md,
    .pdf,
    .docx,
    .xlsx,
    .jpg,
    .jpeg,
    .png,
    text/markdown,
    application/pdf,
    application/vnd.openxmlformats-officedocument.wordprocessingml.document,
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
    image/jpeg,
    image/png
  "
  onChange={selectFile}
/>
<div
  style={{
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  }}
>
  <button
    className="primary"
    disabled={files.length === 0 || busy}
    onClick={() => void importFile()}
  >
    {busy
      ? "Bezig..."
      : files.length === 1
        ? `Analyseer ${files[0].name}`
        : files.length > 1
          ? `Importeer ${files.length} bestanden`
          : "Knowledge Import"}
  </button>

  <button
    className="secondary"
    disabled={files.length !== 1 || busy}
    onClick={() => void archiveFile()}
  >
    {busy
      ? "Bezig..."
      : files.length === 1
        ? `Archiveer ${files[0].name}`
        : "Conversation Archive"}
  </button>
</div>
          {message && <p className="success">{message}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>
      <section className="panel knowledge-import">
  <div>
    <p className="eyebrow">CHAT IMPORT</p>
    <h2>Importeer een gesprek in het Second Brain</h2>

    <p className="muted">
      Plak hier een complete ChatGPT-conversatie. De Matrix zet deze
      automatisch om naar kennisitems voor de Approval Queue.
    </p>
  </div>

  <div className="stack">
    <textarea
      rows={12}
      placeholder="Plak hier de volledige conversatie..."
      value={chatContent}
      onChange={(event) => setChatContent(event.target.value)}
    />

    <button
      className="primary"
      disabled={!chatContent.trim() || chatImporting}
      onClick={() => void importChat()}
    >
      {chatImporting
        ? "Chat wordt geanalyseerd..."
        : "Analyseer chat"}
    </button>
  </div>
</section>
      <section className="knowledge-columns">
        <div className="panel">
        <div className="section-title">
  <div>
    <p className="eyebrow">APPROVAL QUEUE</p>
    <h3>Te beoordelen</h3>
  </div>

  <div className="review-actions">
    <button
      className="secondary"
      disabled={bulkReviewing || pending.length === 0}
      onClick={() => void requestBulkAiReview()}
    >
      {bulkReviewing
        ? `AI Review ${bulkProgress.completed}/${bulkProgress.total}`
        : `🤖 Beoordeel alles (${pending.filter((entry) => !entry.review).length})`}
    </button>
    <button
  className="primary"
  disabled={bulkApplying || pending.length === 0}
  onClick={() => void applyAllReviewSuggestions()}
>
  {bulkApplying
    ? "AI-adviezen toepassen..."
    : "✅ Pas alle AI-adviezen toe"}
</button>
    <span className="badge">{pending.length}</span>
  </div>
</div>

          <div className="knowledge-list knowledge-list--large">
            {pending.length === 0 ? (
              <div className="empty">Geen voorstellen in de wachtrij.</div>
            ) : (
              pending.map((entry) => (
                <article className="knowledge-card" key={entry.id}>
                  {editingId === entry.id ? (
                    <div className="knowledge-edit-form">
                      <label>
                        Titel
                        <input
                          value={editTitle}
                          onChange={(event) => setEditTitle(event.target.value)}
                        />
                      </label>

                      <label>
                        Type
                        <select
                          value={editType ?? "fact"}
                          onChange={(event) =>
                            setEditType(
                              event.target.value as KnowledgeEntry["type"],
                            )
                          }
                        >
                          {Object.entries(knowledgeTypePresentation).map(
                            ([type, presentation]) => (
                              <option value={type} key={type}>
                                {presentation.icon} {presentation.label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      <label>
                        Project
                        <input
                          value={editProject}
                          onChange={(event) => setEditProject(event.target.value)}
                        />
                      </label>

                      <label>
                        Tags, gescheiden door komma&apos;s
                        <input
                          value={editTags}
                          onChange={(event) => setEditTags(event.target.value)}
                        />
                      </label>

                      <label>
                        Inhoud
                        <textarea
                          rows={8}
                          value={editContent}
                          onChange={(event) => setEditContent(event.target.value)}
                        />
                      </label>

                      <div className="review-actions">
                        <button
                          className="primary"
                          disabled={saving}
                          onClick={() => void saveEditing(entry.id)}
                        >
                          {saving ? "Opslaan..." : "Opslaan"}
                        </button>
                        <button
                          className="secondary"
                          disabled={saving}
                          onClick={cancelEditing}
                        >
                          Annuleren
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="knowledge-card-header">
                        <div className="knowledge-type">
                          <span className="knowledge-type-icon">
                            {knowledgeTypePresentation[entry.type ?? "fact"]
                              ?.icon ?? "📌"}
                          </span>
                          <span>
                            {knowledgeTypePresentation[entry.type ?? "fact"]
                              ?.label ??
                              entry.type ??
                              "Feit"}
                          </span>
                        </div>

                        {entry.confidence !== undefined && (
                          <span className="knowledge-confidence">
                            🎯 {Math.round(entry.confidence * 100)}%
                          </span>
                        )}
                      </div>

                      <h4>{entry.title || "Kennisitem zonder titel"}</h4>

                      <div className="knowledge-details">
                        {entry.sourceDocument && (
                          <span>📄 {entry.sourceDocument}</span>
                        )}
                        {entry.sourceSection && (
                          <span>📂 {entry.sourceSection}</span>
                        )}
                        {entry.project && <span>📁 {entry.project}</span>}
                        {entry.lifecycle && (
  <span>🧠 {entry.lifecycle.toUpperCase()}</span>
)}
                      </div>

                      {entry.summary && (
                        <p className="knowledge-summary">{entry.summary}</p>
                      )}

                      <p>{entry.content}</p>

                      {entry.tags.length > 0 && (
                        <div className="knowledge-tags">
                          {entry.tags.map((tag) => (
                            <span className="badge" key={tag}>
                              🏷️ {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {entry.review && (
                        <section
                          className={`ai-review ai-review--${entry.review.recommendation}`}
                        >
                          <div className="ai-review-header">
                            <strong>🤖 AI Review</strong>
                            <span>
                              {Math.round(entry.review.confidence * 100)}% vertrouwen
                            </span>
                          </div>

                          <p className="ai-review-recommendation">
                            Advies: {entry.review.recommendation === "approve"
                              ? "Goedkeuren"
                              : entry.review.recommendation === "edit"
                                ? "Bewerken"
                                : "Afwijzen"}
                          </p>
                          <p>{entry.review.reason}</p>

                          {entry.review.issues.length > 0 && (
                            <ul className="ai-review-issues">
                              {entry.review.issues.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          )}

                          {entry.review.recommendation === "edit" &&
                            entry.review.suggestedTitle &&
                            entry.review.suggestedContent && (
                              <div className="ai-review-suggestion">
                                <strong>Voorgesteld kennisitem</strong>
                                <h5>{entry.review.suggestedTitle}</h5>
                                <p>{entry.review.suggestedContent}</p>
                              </div>
                            )}

                          <div className="review-actions">
                            {entry.review.recommendation === "approve" && (
                              <button
                                className="primary"
                                onClick={() => void review(entry.id, "approved")}
                              >
                                Advies volgen
                              </button>
                            )}
                            {entry.review.recommendation === "reject" && (
                              <button
                                className="primary"
                                onClick={() => void review(entry.id, "rejected")}
                              >
                                Advies volgen
                              </button>
                            )}
                            {entry.review.recommendation === "edit" && (
                              <button
                                className="primary"
                                disabled={applyingId === entry.id}
                                onClick={() => void applyReviewSuggestion(entry)}
                              >
                                {applyingId === entry.id
                                  ? "Voorstel toepassen..."
                                  : "Voorstel toepassen"}
                              </button>
                            )}
                            <button
                              className="secondary"
                              disabled={reviewingId === entry.id}
                              onClick={() => void requestAiReview(entry.id)}
                            >
                              {reviewingId === entry.id
                                ? "Opnieuw beoordelen..."
                                : "Opnieuw beoordelen"}
                            </button>
                          </div>
                        </section>
                      )}

                      <div className="review-actions">
                        {!entry.review && (
                          <button
                            className="secondary"
                            disabled={reviewingId === entry.id}
                            onClick={() => void requestAiReview(entry.id)}
                          >
                            {reviewingId === entry.id
                              ? "AI beoordeelt..."
                              : "🤖 AI Review"}
                          </button>
                        )}
                        <button
                          className="primary"
                          onClick={() => void review(entry.id, "approved")}
                        >
                          Goedkeuren
                        </button>
                        <button
                          className="secondary"
                          onClick={() => void review(entry.id, "rejected")}
                        >
                          Afwijzen
                        </button>
                        <button
                          className="secondary"
                          onClick={() => startEditing(entry)}
                        >
                          Bewerken
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">ACTIVE KNOWLEDGE</p>
              <h3>Goedgekeurd</h3>
            </div>
            <span className="badge">{approved.length}</span>
          </div>

          <div className="knowledge-list knowledge-list--large">
            {approved.length === 0 ? (
              <div className="empty">Nog geen goedgekeurde kennis.</div>
            ) : (
              approved.map((entry) => (
                <article className="knowledge-card" key={entry.id}>
                  <div className="knowledge-meta">
                    <span>
                      {knowledgeTypePresentation[
                        entry.type ?? "legacydocument"
                      ]?.icon ?? "📄"}{" "}
                      {knowledgeTypePresentation[
                        entry.type ?? "legacydocument"
                      ]?.label ?? entry.type}
                    </span>
                    <span>{entry.sourceDocument ?? entry.source}</span>
                  </div>

                  {entry.title && <h4>{entry.title}</h4>}
                  <p>{entry.content}</p>

                  <button
                    className="secondary archive-button"
                    onClick={() => void review(entry.id, "archived")}
                  >
                    Archiveren
                  </button>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">AFGEWEZEN</p>
            <h3>Afgewezen kennisitems</h3>
          </div>

          <div className="review-actions">
            <span className="badge">{rejectedEntries.length}</span>
            <button
              className="secondary"
              onClick={() => setShowRejected((current) => !current)}
            >
              {showRejected ? "Verbergen" : "Tonen"}
            </button>
          </div>
        </div>

        {showRejected && (
          <div className="knowledge-list knowledge-list--large">
            {rejectedEntries.length === 0 ? (
              <div className="empty">Geen afgewezen kennisitems.</div>
            ) : (
              rejectedEntries.map((entry) => (
                <article className="knowledge-card" key={entry.id}>
                  <div className="knowledge-meta">
                    <span>
                      {knowledgeTypePresentation[entry.type ?? "fact"]?.icon ?? "📌"}{" "}
                      {knowledgeTypePresentation[entry.type ?? "fact"]?.label ?? entry.type}
                    </span>
                    <span>{entry.sourceDocument ?? entry.source}</span>
                  </div>

                  <h4>{entry.title || "Kennisitem zonder titel"}</h4>
                  <p>{entry.content}</p>

                  {entry.review?.reason && (
                    <p className="knowledge-summary">AI-advies was: {entry.review.reason}</p>
                  )}

                  <div className="review-actions">
                    <button
                      className="primary"
                      disabled={restoringId === entry.id}
                      onClick={() => void restoreToPending(entry.id)}
                    >
                      {restoringId === entry.id
                        ? "Terugzetten..."
                        : "Terugzetten naar wachtrij"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </section>
    </main>
  );
}
