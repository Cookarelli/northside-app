import Link from "next/link";
export default function Page() {
  return (
    <>
      <div className="intro">
        <p className="eyebrow">NORTHSIDE GRADING</p>
        <h1>Grading / Track My Cards</h1>
        <p>
          Your received cards, photos, Northside Exam, quotes and grading
          progress in one secure portal.
        </p>
      </div>
      <section className="panel">
        <h2>Start with a grading request</h2>
        <p>
          Tell Northside about your cards and select a configured service or
          request staff review. Keep the saved reference to follow staff review
          and customer-visible status in My Cards.
        </p>
        <Link
          className="button"
          prefetch={false}
          href="/services/request?service=grading"
        >
          Start a grading request or inquiry
        </Link>
        <p>
          A request does not confirm physical receipt, take payment or submit
          cards to a grader. Wait for Northside’s receiving instructions before
          sending cards.
        </p>
        <h2>Already dropped off cards?</h2>
        <p>
          Open My Cards to review the cards linked to your Northside Shopify
          customer account. You can approve selected cards for external grading
          or request their return.
        </p>
        <Link className="button" prefetch={false} href="/my-cards/grading">
          Track my cards →
        </Link>
        <p>
          PSA is our confirmed grading provider. Service availability and
          external grading, shipping, insurance and other charges will appear in
          your itemized quote when configured.
        </p>
        <p>
          A Northside Exam is our assessment, separate from the external
          grader’s final result. A projected grade is not guaranteed.
        </p>
      </section>
    </>
  );
}
