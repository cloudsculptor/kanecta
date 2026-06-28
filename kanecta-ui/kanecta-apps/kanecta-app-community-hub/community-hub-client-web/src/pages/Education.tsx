import PageLayout from "../components/PageLayout";

export default function Education() {
  return (
    <PageLayout pageName="Education" showComingSoon={false}>
      <p>
        Schools, early childhood services, and learning resources in Featherston.
      </p>

      <h3>Primary Schools</h3>
      <p>Featherston has three primary schools covering Years 1–8.</p>
      <ul>
        <li>
          <a href="https://www.featherston.school.nz/" target="_blank" rel="noopener noreferrer">
            Featherston School (Te Kura o Paetūmokai)
          </a>{" "}
          — state primary school on Lyon Street, Years 1–8
        </li>
        <li>
          <a href="https://www.southfeatherston.school.nz/" target="_blank" rel="noopener noreferrer">
            South Featherston School
          </a>{" "}
          — small rural school south of town, Years 1–8
        </li>
        <li>
          <a href="https://www.teresas.school.nz/" target="_blank" rel="noopener noreferrer">
            St Teresa's School
          </a>{" "}
          — Catholic state-integrated school on Bell Street, Years 1–8
        </li>
      </ul>

      <h3>Secondary School</h3>
      <p>
        There is no secondary school in Featherston. Students travel to Greytown or Masterton,
        with bus services running daily.
      </p>
      <ul>
        <li>
          <a href="https://www.kuranui.school.nz/" target="_blank" rel="noopener noreferrer">
            Kuranui College
          </a>{" "}
          — the nearest secondary school, in Greytown (South Wairarapa), Years 9–13,
          with bus services from Featherston
        </li>
      </ul>

      <h3>Early Childhood Education</h3>
      <ul>
        <li>
          <a href="https://ero.govt.nz/institution/45057/bell-street-early-learning-centre" target="_blank" rel="noopener noreferrer">
            Bell Street Early Learning Centre
          </a>{" "}
          — play-based childcare and education on Bell Street. Licensed from birth, offers
          20 hours free ECE for over-3s. Note: currently has a waiting list.
        </li>
      </ul>
      <p>
        For a full list of licensed early childhood providers in Featherston, see the{" "}
        <a href="https://www.education.govt.nz/early-childhood/finding-an-early-childhood-service/" target="_blank" rel="noopener noreferrer">
          Ministry of Education ECE finder
        </a>
        .
      </p>

      <h3>Library</h3>
      <ul>
        <li>
          <a href="https://swdc.govt.nz/services/libraries/" target="_blank" rel="noopener noreferrer">
            Featherston Library
          </a>{" "}
          — 70–72 Fitzherbert Street. Open Monday–Friday 9:30am–5pm, Saturday 9:30am–12pm.
          Library members can also borrow from Greytown and Martinborough, and access the
          wider Wellington region library network.
        </li>
      </ul>

      <h3>Adult &amp; Community Learning</h3>
      <ul>
        <li>
          <a href="https://www.reapwairarapa.nz/" target="_blank" rel="noopener noreferrer">
            REAP Wairarapa
          </a>{" "}
          — Rural Education Activities Programme offering adult and community education across
          the Wairarapa, including literacy, maths, financial capability courses, and youth
          employment support
        </li>
        <li>
          <a href="https://www.ucol.ac.nz/study-at-ucol/Campus-details/wairarapa" target="_blank" rel="noopener noreferrer">
            UCOL — Wairarapa Campus
          </a>{" "}
          — polytechnic campus in Masterton with trades, business, health, and other tertiary
          programmes (part of Te Pūkenga)
        </li>
        <li>
          <a href="https://www.openpolytechnic.ac.nz/" target="_blank" rel="noopener noreferrer">
            Open Polytechnic
          </a>{" "}
          — flexible online study from home across a wide range of qualifications — ideal for
          those in rural and regional areas
        </li>
      </ul>

      <h3>Learning Support</h3>
      <ul>
        <li>
          <a href="https://www.education.govt.nz/parents-and-caregivers/schools-year-0-13/learning-support/" target="_blank" rel="noopener noreferrer">
            Ministry of Education — Learning Support
          </a>{" "}
          — information on specialist support available through your child's school, including
          Resource Teachers (RTLB), early intervention, and the Ongoing Resourcing Scheme (ORS)
        </li>
        <li>
          <a href="https://goodliveswairarapa.nz/resources/wairarapa-disability-support-services/" target="_blank" rel="noopener noreferrer">
            Good Lives Wairarapa — Disability Support Services
          </a>{" "}
          — local directory of disability and learning support services across the Wairarapa
        </li>
      </ul>

      <h3>NCEA &amp; Careers</h3>
      <ul>
        <li>
          <a href="https://www2.nzqa.govt.nz/ncea/" target="_blank" rel="noopener noreferrer">
            NZQA — NCEA
          </a>{" "}
          — everything you need to know about NCEA qualifications, credits, and standards
        </li>
        <li>
          <a href="https://www.careers.govt.nz/" target="_blank" rel="noopener noreferrer">
            Careers New Zealand
          </a>{" "}
          — free career planning tools, subject choice guidance, and information on study
          and training options
        </li>
        <li>
          <a href="https://tahatu.govt.nz/" target="_blank" rel="noopener noreferrer">
            Tahatū — Career Navigator
          </a>{" "}
          — helps secondary students explore career pathways and choose the right NCEA subjects
        </li>
        <li>
          <a href="https://www.educationcounts.govt.nz/find-school/schools?district=50" target="_blank" rel="noopener noreferrer">
            Education Counts — South Wairarapa
          </a>{" "}
          — directory of all schools and early childhood services in the South Wairarapa district
        </li>
      </ul>
    </PageLayout>
  );
}
