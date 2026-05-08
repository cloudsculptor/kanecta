import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import PageLayout from "../components/PageLayout";

export default function Volunteering() {
  const [open, setOpen] = useState(false);

  return (
    <PageLayout pageName="Volunteering" showComingSoon={false}>
      <p className="gov-lead">
        This site is run entirely by people who care about Featherston giving their time. Here's how you can be part of it.
      </p>

      <div className="vol-cards">

        <div className="vol-card">
          <div className="vol-card__tag">Governance</div>
          <h3 className="vol-card__title">Join the Custodian Board pool</h3>
          <p className="vol-card__pitch">
            The Custodian Board is how this site stays independent forever. Five community members, chosen by random selection, who make sure nothing goes wrong and nobody captures this resource for their own ends.
          </p>
          <p className="vol-card__pitch">
            You don't need special skills. You don't need to campaign or be well known. You just need to care about Featherston having a community resource that nobody can own.
          </p>
          <h4 className="vol-card__section">What's involved</h4>
          <ul className="vol-card__list">
            <li>One year term if selected</li>
            <li>Four meetings a year — roughly one per quarter</li>
            <li>Reading and responding to occasional written matters between meetings</li>
            <li>Acting with fairness when complaints or concerns arise</li>
          </ul>
          <h4 className="vol-card__section">What you won't be asked to do</h4>
          <ul className="vol-card__list">
            <li>Run the site day to day — that's volunteers</li>
            <li>Make decisions about content or features — that's volunteers too</li>
            <li>Have a particular set of skills or background</li>
          </ul>
          <p className="vol-card__note">
            Putting your name forward doesn't mean you'll be selected — selection is by random lot from everyone who is willing. But we can't have a functioning board without people in the pool.
          </p>
          <button className="vol-card__cta" onClick={() => setOpen(true)}>
            Put my name forward →
          </button>
        </div>

        <div className="vol-card">
          <div className="vol-card__tag">Volunteering</div>
          <h3 className="vol-card__title">Help build and run this site</h3>
          <p className="vol-card__pitch">
            Volunteers are the organisation. Everything you see on this site — the content, the features, the design, the community information — was created by people who live in or care about Featherston and gave their time to build something worthwhile.
          </p>
          <p className="vol-card__pitch">
            We're a small, friendly team. No bureaucracy, no approval chains. You pick something useful to work on and you do it. The energy here comes from people who genuinely enjoy it.
          </p>
          <h4 className="vol-card__section">Things people work on</h4>
          <ul className="vol-card__list">
            <li>Writing and maintaining community information</li>
            <li>Building and improving the site's features</li>
            <li>Design, accessibility, and user experience</li>
            <li>Keeping content up to date and accurate</li>
            <li>Connecting with community groups and helping them get listed</li>
          </ul>
          <h4 className="vol-card__section">What we're looking for</h4>
          <ul className="vol-card__list">
            <li>Someone who cares about the community</li>
            <li>Reliability over brilliance — consistent small contributions beat occasional heroics</li>
            <li>Kindness and the ability to work well with others</li>
            <li>Any skill level welcome — there's something meaningful for everyone</li>
          </ul>
          <button className="vol-card__cta" onClick={() => setOpen(true)}>
            Get in touch →
          </button>
        </div>

      </div>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Coming soon</DialogTitle>
        <DialogContent>
          <p style={{ margin: 0 }}>
            Online sign-up isn't available just yet. In the meantime, drop us a line at{" "}
            <a href="mailto:hello@featherston.co.nz">hello@featherston.co.nz</a> and we'll be in touch.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

    </PageLayout>
  );
}
