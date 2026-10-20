"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  blankExam,
  examProblems,
  MAX_PHOTO_BYTES,
  photoHelp,
  photoKinds,
  photoLabels,
  scoreFields,
  type ExamFields,
  type ExamPhoto,
  type ExamWorkspace,
  type PhotoKind,
} from "@/lib/exam";

const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(value));
const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to save. Your received card remains saved; retry when connected.";
async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(
      String(
        data.error || "Connection failed. Retry when connected.",
      ).replaceAll("_", " "),
    );
  return data;
}
export function PhotoView({
  photo,
  endpoint,
}: {
  photo: ExamPhoto;
  endpoint: string;
}) {
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [zoom, setZoom] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const src = `${endpoint}&photo=${photo.id}&retry=${retry}`;
  return (
    <div className="exam-photo-view">
      {failed ? (
        <p role="alert">
          Stored photo unavailable.{" "}
          <button
            type="button"
            className="plain"
            onClick={() => {
              setFailed(false);
              setRetry((n) => n + 1);
            }}
          >
            Retry photo
          </button>
        </p>
      ) : (
        <button
          className="exam-image-button"
          type="button"
          aria-label={`Zoom ${photoLabels[photo.kind]} photo`}
          onClick={() => {
            setZoom(1);
            dialog.current?.showModal();
          }}
        >
          <Image
            unoptimized
            src={src}
            width={photo.width || 600}
            height={photo.height || 840}
            alt={`${photoLabels[photo.kind]} of this card`}
            onError={() => setFailed(true)}
          />
        </button>
      )}
      <dialog
        ref={dialog}
        className="exam-zoom"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="exam-zoom-controls">
          <strong>{photoLabels[photo.kind]}</strong>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
          <label>
            Zoom {zoom}×{" "}
            <input
              aria-label="Photo zoom"
              type="range"
              min="1"
              max="4"
              step="0.25"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="exam-zoom-scroll">
          <Image
            unoptimized
            src={src}
            width={photo.width || 600}
            height={photo.height || 840}
            alt={`${photoLabels[photo.kind]} enlarged`}
            style={{
              width: `${zoom * 100}%`,
              maxWidth: "none",
              height: "auto",
            }}
          />
        </div>
      </dialog>
    </div>
  );
}
export function PhotoCapture({
  kind,
  endpoint,
  locked,
  onBusy,
  onSaved,
}: {
  kind: PhotoKind;
  endpoint: string;
  locked: boolean;
  onBusy: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [selection, setSelection] = useState<{
      file: File;
      request: string;
    } | null>(null),
    [preview, setPreview] = useState(""),
    [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null),
    uploading = useRef(false);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => () => xhrRef.current?.abort(), []);
  const pick = (file: File | undefined) => {
    if (!file) return;
    setError("");
    setStatus("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Unsupported format. " + photoHelp);
      return;
    }
    if (!file.size || file.size > MAX_PHOTO_BYTES) {
      setError("Choose a photo up to 4 MiB. Your card record is saved.");
      return;
    }
    setSelection({ file, request: crypto.randomUUID() });
    setPreview(URL.createObjectURL(file));
  };
  const upload = async () => {
    if (!selection || uploading.current) return;
    uploading.current = true;
    onBusy(true);
    setProgress(0);
    setError("");
    setStatus("Preparing private upload…");
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await selection.file.arrayBuffer(),
      );
      const hash = [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      const prepared = await responseJson(
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "photo-prepare",
            kind,
            request_id: selection.request,
            source_hash: hash,
          }),
        }),
      );
      setStatus("Uploading…");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("PUT", `${endpoint}&photo=${prepared.id}`);
        xhr.timeout = 60000;
        xhr.setRequestHeader("Content-Type", selection.file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const n = Math.round((e.loaded / e.total) * 100);
            setProgress(n);
            if (n === 100)
              setStatus("Upload sent. Confirming private storage…");
          }
        };
        xhr.onload = () => {
          let data: { error?: string; confirmed?: boolean } = {};
          try {
            data = JSON.parse(xhr.responseText);
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && data.confirmed === true)
            resolve();
          else
            reject(
              Error(
                (
                  data.error ||
                  "Upload unconfirmed. Retry this photo; the received card remains saved."
                ).replaceAll("_", " "),
              ),
            );
        };
        xhr.onerror =
          xhr.ontimeout =
          xhr.onabort =
            () =>
              reject(
                Error(
                  "Connection interrupted. Retry this photo. Your card and any completed photos remain saved.",
                ),
              );
        xhr.send(selection.file);
      });
      await onSaved();
      setSelection(null);
      setPreview("");
      setStatus("Confirmed in private storage.");
    } catch (e) {
      setError(messageFor(e));
      setStatus("Upload not confirmed. Preview only.");
    } finally {
      uploading.current = false;
      xhrRef.current = null;
      setProgress(null);
      onBusy(false);
    }
  };
  return (
    <div className="exam-capture">
      <div className="exam-capture-inputs">
        <label className="exam-file-label">
          Take {photoLabels[kind].toLowerCase()} photo
          <input
            aria-label={`Take ${photoLabels[kind]} photo`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={locked || progress !== null}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <label className="exam-file-label">
          Choose file
          <input
            aria-label={`Upload ${photoLabels[kind]} file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={locked || progress !== null}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {selection && (
        <>
          <p>
            <strong>Preview only — not yet saved</strong>
          </p>
          {preview && (
            <Image
              className="exam-local-preview"
              unoptimized
              src={preview}
              width={600}
              height={840}
              alt={`Unsaved ${photoLabels[kind]} preview`}
            />
          )}
          <div className="exam-actions">
            <button
              type="button"
              className="button"
              disabled={locked || progress !== null}
              onClick={upload}
            >
              {error ? "Retry upload" : "Upload this photo"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={progress !== null}
              onClick={() => {
                setSelection(null);
                setPreview("");
                setError("");
                setStatus("Use Take photo to retake, or Choose file.");
              }}
            >
              Retake / replace
            </button>
          </div>
        </>
      )}
      {progress !== null && (
        <>
          <progress
            aria-label={`${photoLabels[kind]} upload progress`}
            value={progress}
            max="100"
          />
          <span>{progress}% transferred</span>
        </>
      )}
      <p role="status">{status}</p>
      {error && (
        <p className="exam-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function NorthsideExam({
  cardId,
  fixture,
  staff,
  sampleActor = "a",
}: {
  cardId: string;
  fixture: boolean;
  staff: boolean;
  sampleActor?: string;
}) {
  const endpoint = `/api/${fixture ? "preview" : "private"}/grading/exam?card=${encodeURIComponent(cardId)}${fixture ? `&actor=${staff ? "staff" : sampleActor === "b" ? "b" : "a"}` : ""}`;
  const [data, setData] = useState<ExamWorkspace | null>(null),
    [fields, setFields] = useState<ExamFields>({ ...blankExam }),
    [notes, setNotes] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [signoff, setSignoff] = useState(false),
    [reason, setReason] = useState(""),
    [revisionId, setRevisionId] = useState("");
  const load = useCallback(async () => {
    const value: ExamWorkspace = await responseJson(
      await fetch(endpoint, { cache: "no-store" }),
    );
    setData(value);
    setFields(value.draft?.fields ?? { ...blankExam });
    setNotes(value.draft?.internal_notes ?? "");
    setDirty(false);
    setSignoff(false);
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(responseJson)
      .then((value: ExamWorkspace) => {
        if (active) {
          setData(value);
          setFields(value.draft?.fields ?? { ...blankExam });
          setNotes(value.draft?.internal_notes ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(messageFor(e));
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const send = async (body: Record<string, unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await responseJson(
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      await load();
      setStatus(success);
      setReason("");
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };
  const change = (update: Partial<ExamFields>) => {
    setFields((value) => ({ ...value, ...update }));
    setDirty(true);
    setSignoff(false);
  };
  const selectedRevision =
    data?.revisions.find((r) => r.id === revisionId) ?? data?.revisions[0];
  const problems = data ? examProblems(fields, data.photos) : [];
  const alreadyPublished =
    data?.revisions.some((r) => r.draft_version === data.draft?.version) ??
    false;
  const writable = !!data?.writer && !data.voided;
  const currentPhotos = data?.writer
    ? data.photos
    : (selectedRevision?.photos ?? data?.photos ?? []);
  return (
    <section className="northside-exam">
      <Link
        href={staff ? "/staff/grading" : "/my-cards/grading"}
        prefetch={false}
      >
        ← {staff ? "Grading desk" : "My grading cards"}
      </Link>
      <div className="intro">
        <p className="eyebrow">NORTHSIDE CARD SERVICES</p>
        <h1>Northside Exam</h1>
        <p>Card photography and a manually recorded assessment.</p>
      </div>
      {fixture && (
        <aside className="grading-notice">
          <strong>SAMPLE WORKSPACE — local records only</strong>
          <p>
            Use sample photos for this rehearsal. Staff and collector identities
            are fictional. Real phone capture and hosted storage still require
            verification.
          </p>
        </aside>
      )}
      {error && (
        <p className="exam-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="plain"
            disabled={busy}
            onClick={() =>
              load()
                .then(() => {
                  setError("");
                  setStatus("Reloaded saved records.");
                })
                .catch((e) => setError(messageFor(e)))
            }
          >
            Reload saved record
          </button>
          {!data && (
            <Link
              href={
                staff
                  ? "/staff/login"
                  : `/account?returnTo=${encodeURIComponent(`/my-cards/grading/exam/${cardId}`)}`
              }
            >
              {" "}
              Sign in
            </Link>
          )}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Working — keep this page open…" : status}
      </p>
      {!data && !error && <p>Loading saved card and exam…</p>}
      {data && (
        <>
          <header className="exam-card-heading">
            <h2>{data.description}</h2>
            <p className="fine">Permanent card ID: {data.card_id}</p>
            {data.voided && <p>Intake reversed. This record is read-only.</p>}
          </header>
          <div className="exam-layout">
            <section className="panel exam-photography">
              <h2>Card photographs</h2>
              {data.writer && (
                <>
                  <p className="grading-notice">
                    <strong>
                      {data.photos_complete
                        ? "Front and back confirmed in storage"
                        : "Photos missing"}
                    </strong>
                    {!data.photos_complete && (
                      <span>
                        {" "}
                        · Card received and saved. Add the missing front/back
                        photos to complete this task.
                      </span>
                    )}
                  </p>
                  <p className="fine">{photoHelp}</p>
                  <p className="fine">
                    On a phone or tablet, Take photo requests the rear camera.
                    If your browser opens a file picker or camera access is
                    unavailable, use Choose file.
                  </p>
                  {dirty && <p>Save the exam draft before changing photos.</p>}
                </>
              )}
              {photoKinds
                .filter(
                  (k) =>
                    !k.startsWith("returned_") &&
                    (data.writer || k !== "paper"),
                )
                .map((kind) => (
                  <section className="exam-photo-slot" key={kind}>
                    <h3>
                      {photoLabels[kind]}{" "}
                      {kind === "front" || kind === "back"
                        ? "· required"
                        : "· optional"}
                    </h3>
                    {kind === "paper" && (
                      <p className="fine">
                        Reference for staff only. Copy customer-safe findings
                        into Notes; this photo is excluded from the customer
                        report.
                      </p>
                    )}
                    {currentPhotos
                      ?.filter((p) => p.kind === kind && p.ready)
                      .map((photo) => (
                        <div key={photo.id}>
                          <PhotoView photo={photo} endpoint={endpoint} />
                          <p className="fine">
                            Confirmed{" "}
                            {photo.confirmed_at ? when(photo.confirmed_at) : ""}{" "}
                            · tap image to zoom
                          </p>
                          {writable && (
                            <button
                              type="button"
                              className="plain"
                              disabled={busy || dirty}
                              onClick={() =>
                                send(
                                  { action: "photo-remove", id: photo.id },
                                  "Removed from the draft. Published reports keep their original photos.",
                                )
                              }
                            >
                              Remove from draft
                            </button>
                          )}
                        </div>
                      ))}
                    {!currentPhotos?.some(
                      (p) => p.kind === kind && p.ready,
                    ) && (
                      <p>
                        {kind === "front" || kind === "back"
                          ? "No confirmed photo."
                          : "None added."}
                      </p>
                    )}
                    {data.writer &&
                      currentPhotos
                        ?.filter((p) => p.kind === kind && !p.ready)
                        .map((photo) => (
                          <div className="exam-pending" key={photo.id}>
                            <p>
                              Unconfirmed upload. Choose the same file and
                              retry, or discard this attempt.
                            </p>
                            <button
                              className="plain"
                              type="button"
                              disabled={busy || dirty}
                              onClick={() =>
                                send(
                                  { action: "photo-remove", id: photo.id },
                                  "Pending attempt discarded. The card remains saved.",
                                )
                              }
                            >
                              Discard pending attempt
                            </button>
                          </div>
                        ))}
                    {writable && (
                      <PhotoCapture
                        kind={kind}
                        endpoint={endpoint}
                        locked={busy || dirty}
                        onBusy={setBusy}
                        onSaved={load}
                      />
                    )}
                  </section>
                ))}
            </section>
            <section className="exam-assessment">
              {data.writer && (
                <section className="panel">
                  <h2>
                    {alreadyPublished && !dirty
                      ? "Published assessment"
                      : data.revisions.length
                        ? "Correction draft"
                        : "Draft assessment"}
                  </h2>
                  <p>
                    {data.draft?.updated_at
                      ? `Last saved ${when(data.draft.updated_at)}.`
                      : "Scores stay blank until an examiner enters them."}{" "}
                    {dirty ? "Unsaved changes." : ""}
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      send(
                        {
                          action: "save-draft",
                          version: data.draft?.version ?? 0,
                          fields,
                          internal_notes: notes,
                        },
                        "Draft saved. It is not customer-visible until published.",
                      );
                    }}
                  >
                    <fieldset
                      disabled={busy || !writable}
                      className="exam-form"
                    >
                      <div className="exam-scores">
                        {scoreFields.map((key) => (
                          <label key={key}>
                            {key[0].toUpperCase() + key.slice(1)}
                            <input
                              name={key}
                              type="number"
                              inputMode="numeric"
                              min="1"
                              max="10"
                              step="1"
                              placeholder="—"
                              value={fields[key] ?? ""}
                              onChange={(e) =>
                                change({
                                  [key]:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                            />
                            <span className="fine">Integer 1–10</span>
                          </label>
                        ))}
                      </div>
                      <label>
                        Notes · customer visible findings
                        <textarea
                          name="notes"
                          rows={5}
                          maxLength={10000}
                          value={fields.notes}
                          onChange={(e) => change({ notes: e.target.value })}
                        />
                      </label>
                      <label>
                        Projected grade · manually entered
                        <input
                          name="projected_grade"
                          maxLength={80}
                          disabled={fields.unable_to_estimate}
                          value={fields.projected_grade}
                          onChange={(e) =>
                            change({ projected_grade: e.target.value })
                          }
                        />
                      </label>
                      <label className="exam-check">
                        <input
                          type="checkbox"
                          checked={fields.unable_to_estimate}
                          onChange={(e) =>
                            change({
                              unable_to_estimate: e.target.checked,
                              projected_grade: e.target.checked
                                ? ""
                                : fields.projected_grade,
                            })
                          }
                        />
                        Unable to estimate
                      </label>
                      <p className="fine">
                        Northside’s estimate is independent of an external
                        grader’s final result. No grade is generated from photos
                        or calculated from the four scores.
                      </p>
                      <label>
                        Internal staff notes · never shown to customers
                        <textarea
                          name="internal_notes"
                          rows={4}
                          maxLength={10000}
                          value={notes}
                          onChange={(e) => {
                            setNotes(e.target.value);
                            setDirty(true);
                            setSignoff(false);
                          }}
                        />
                      </label>
                      <button
                        className="button secondary"
                        type="submit"
                        disabled={!dirty}
                      >
                        Save draft
                      </button>
                    </fieldset>
                  </form>
                  <div className="exam-publication">
                    <h3>Signature & publication</h3>
                    {alreadyPublished && !dirty ? (
                      <p>
                        This saved assessment is published. Edit and save a
                        draft to create a new revision.
                      </p>
                    ) : (
                      <>
                        <p>
                          Publishing makes this saved assessment and its card
                          photos visible to the customer. Earlier published
                          revisions remain unchanged.
                        </p>
                        {problems.length > 0 && (
                          <>
                            <p>Still required:</p>
                            <ul>
                              {problems.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          </>
                        )}
                        <label>
                          {data.revisions.length
                            ? "Correction reason (required, staff only)"
                            : "Publication reason (required, staff only)"}
                          <textarea
                            rows={2}
                            maxLength={1000}
                            value={reason}
                            disabled={busy || !writable}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                        <label className="exam-check">
                          <input
                            type="checkbox"
                            checked={signoff}
                            disabled={busy || dirty || !writable}
                            onChange={(e) => setSignoff(e.target.checked)}
                          />
                          I have examined this card and sign off on this saved
                          assessment.
                        </label>
                        <p className="fine">
                          Authenticated examiner: {data.examiner_id}. The server
                          records the signature and timestamp on publication.
                        </p>
                        <button
                          className="button"
                          type="button"
                          disabled={
                            busy ||
                            dirty ||
                            !writable ||
                            problems.length > 0 ||
                            !signoff ||
                            !reason.trim()
                          }
                          onClick={() =>
                            send(
                              {
                                action: "publish",
                                version: data.draft?.version,
                                signoff,
                                reason,
                              },
                              "Exam published. Its signed revision and photos are preserved.",
                            )
                          }
                        >
                          {data.revisions.length
                            ? "Publish new revision"
                            : "Publish exam"}
                        </button>
                        {dirty && (
                          <p>Save your draft before signing and publishing.</p>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )}
              <section className="panel exam-published">
                <h2>Published customer reports</h2>
                {!data.revisions.length && (
                  <p>
                    No exam has been published. Draft scores and notes are
                    private.
                  </p>
                )}
                {selectedRevision && (
                  <>
                    <label>
                      Revision
                      <select
                        value={selectedRevision.id}
                        onChange={(e) => setRevisionId(e.target.value)}
                      >
                        {data.revisions.map((r) => (
                          <option value={r.id} key={r.id}>
                            Revision {r.revision} · {when(r.signed_at)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <dl className="exam-result-scores">
                      {scoreFields.map((k) => (
                        <div key={k}>
                          <dt>{k[0].toUpperCase() + k.slice(1)}</dt>
                          <dd>{selectedRevision[k]} / 10</dd>
                        </div>
                      ))}
                    </dl>
                    <h3>Notes</h3>
                    <p className="preserve-lines">
                      {selectedRevision.notes ||
                        "No additional findings recorded."}
                    </p>
                    <h3>Projected grade</h3>
                    <p>
                      {selectedRevision.unable_to_estimate
                        ? "Unable to estimate"
                        : selectedRevision.projected_grade}
                    </p>
                    <h3>Signature</h3>
                    {data.writer && (
                      <p className="fine">
                        Publication / correction reason (staff only):{" "}
                        {data.revision_reasons?.[selectedRevision.id]}
                      </p>
                    )}
                    <p className="fine">
                      Authenticated Northside examiner{" "}
                      {selectedRevision.signed_by}
                      <br />
                      {when(selectedRevision.signed_at)} · America/Chicago
                    </p>
                    <a
                      className="button secondary"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`${endpoint}&report=${selectedRevision.id}`}
                    >
                      Open printable report · revision{" "}
                      {selectedRevision.revision}
                    </a>
                    <p className="fine">
                      The report includes that revision’s photos and public
                      findings. Northside’s estimate is not an external grading
                      result.
                    </p>
                  </>
                )}
              </section>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
