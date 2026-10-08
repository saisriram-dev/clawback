import Link from 'next/link';
import { Logo } from '@/components/ui';
import { Estimator } from '@/components/estimator';
import { DemoButton } from '@/components/auth-form';
import '@/components/public.css';

export const metadata = {
  title: 'ClawBack | Get your share of the US tariff refund',
  description: 'Indian exporters cut prices to absorb US IEEPA tariffs. The tariffs were struck down and the refunds go to US buyers. ClawBack proves your share and helps you get it back.',
};

const OPTIONS = [
  { id: 'A', title: 'Full settlement', text: 'The buyer pays your whole share, including CBP interest, against your credit note within 30 days.' },
  { id: 'B', title: 'Split it 50/50', text: 'Both sides share the refund your discount paid for. A visible concession that closes fast.' },
  { id: 'C', title: 'Credit on the next orders', text: 'Your share comes off the next two invoices. No cash leaves their account, so buyers accept this most often.' },
];

export default function Welcome() {
  return (
    <div className="pub">
      <header className="pub-nav">
        <Link href="/welcome" className="pub-brand"><Logo size={30} /><span>ClawBack</span></Link>
        <nav>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/login">Sign in</Link>
          <DemoButton className="btn accent sm" label="Try the live demo" />
        </nav>
      </header>

      <section className="pub-hero">
        <div className="pub-hero-copy">
          <h1>Your US buyer got the tariff refund. Part of it is yours.</h1>
          <p className="lead">
            In 2025 you cut your prices so US buyers could survive tariffs of up to 50%. In February 2026 the US Supreme Court struck those tariffs down, and the refunds, with interest, are going to your buyers. ClawBack proves how much your discounts paid for and builds a claim they can say yes to.
          </p>
          <div className="pub-cta">
            <DemoButton className="btn accent lg" label="Try the live demo" />
            <Link className="btn lg ghost-light" href="/signup">Create a free account</Link>
          </div>
          <p className="pub-proof">About $166 billion in IEEPA tariffs is being refunded. Roughly $12 billion of it is tied to goods from India.</p>
        </div>
        <Estimator />
      </section>

      <section className="pub-sec" id="how">
        <h2>From a folder of invoices to money back</h2>
        <ol className="steps">
          <li>
            <h3>Upload what you already have</h3>
            <p>Invoices, price-revision emails, e-BRC and FIRA bank certificates. PDFs, Excel, Word, email files, even a phone photo of an invoice.</p>
          </li>
          <li>
            <h3>See the proof behind every number</h3>
            <p>Gemma, an open AI model, reads each document and cites the exact line. Plain code does the maths with the dated tariff table and CBP interest. Click any figure to see where it came from.</p>
          </li>
          <li>
            <h3>Send a claim they can accept</h3>
            <p>A claim pack with numbered exhibits, three settlement options, ready answers to the usual objections, and a link your buyer opens to choose. Share it on WhatsApp or email.</p>
          </li>
        </ol>
      </section>

      <section className="pub-sec pub-ladder">
        <h2>Never ask for cash only</h2>
        <p className="pub-sec-lead">There is no law that makes a US buyer share the refund. So ClawBack turns the request into a business decision with three ways to say yes.</p>
        <div className="opts">
          {OPTIONS.map((o) => (
            <div key={o.id} className={`opt${o.id === 'C' ? ' rec' : ''}`}>
              <span className="opt-id">Option {o.id}</span>
              <h3>{o.title}</h3>
              <p>{o.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pub-sec pub-trust">
        <div>
          <h2>Built so the numbers hold up in front of a buyer</h2>
          <p className="pub-sec-lead">AI reads the documents. Deterministic code does the maths. A person approves every number. Same documents in, same claim out, every time.</p>
        </div>
        <dl className="facts">
          <div><dt>Grounding check</dt><dd>Every value the model returns must appear on the line it cites, or it is flagged for review.</dd></div>
          <div><dt>Dated tariff table</dt><dd>10%, 25% and 50% IEEPA rates by entry date, including the in-transit exceptions.</dd></div>
          <div><dt>Private by design</dt><dd>Each company signs in to its own workspace. Run it on your laptop with Gemma offline, or in the cloud.</dd></div>
          <div><dt>Tested</dt><dd>37 automated tests cover the rate table, interest, extraction, grounding, the Gemma clients and account isolation.</dd></div>
        </dl>
      </section>

      <section className="pub-sec" id="pricing">
        <h2>Pay when it works</h2>
        <div className="plans">
          <div className="plan">
            <h3>Free</h3>
            <div className="price">₹0</div>
            <ul>
              <li>Refund estimator</li>
              <li>Upload and verify documents</li>
              <li>Portfolio for all your buyers</li>
            </ul>
            <Link className="btn" href="/signup">Start free</Link>
          </div>
          <div className="plan hot">
            <h3>Success fee</h3>
            <div className="price">7%<small> of what you recover</small></div>
            <ul>
              <li>Claim packs for every buyer</li>
              <li>Buyer response links and pipeline</li>
              <li>Nothing to pay if a buyer says no</li>
            </ul>
            <Link className="btn accent" href="/signup">Create account</Link>
          </div>
          <div className="plan">
            <h3>Claim pack</h3>
            <div className="price">₹4,999<small> per buyer</small></div>
            <ul>
              <li>For exporters who negotiate themselves</li>
              <li>One complete claim pack and response link</li>
              <li>CA and export council partner pricing</li>
            </ul>
            <Link className="btn" href="/signup">Get started</Link>
          </div>
        </div>
      </section>

      <footer className="pub-foot">
        <div className="pub-brand"><Logo size={24} /><span>ClawBack</span></div>
        <p>ClawBack prepares negotiation material for exporters whose US buyers received IEEPA duty refunds. It is negotiation support, not legal advice. Confirm the treatment of your entries with your customs broker.</p>
        <p>Built by Sai Sri Ram Pitta, Tanish Kinthali, Adithya Bukkineni and Harshith Reddy.</p>
      </footer>
    </div>
  );
}
