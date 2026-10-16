"use client";

export function privacyDocumentId() {
  const root = document.documentElement;
  return (root.dataset.nsPrivacySource ||= crypto.randomUUID());
}
