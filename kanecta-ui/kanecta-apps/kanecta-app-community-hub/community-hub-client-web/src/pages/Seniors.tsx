import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function Seniors() {
  return (
    <PageLayout pageName="Seniors" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="seniors" title="Seniors">
      <p>
        Services, activities, and support for older residents of Featherston.
      </p>

      <h3>Local Groups &amp; Activities</h3>
      <ul>
        <li>
          <a href="https://digitalseniors.co.nz/" target="_blank" rel="noopener noreferrer">
            Digital Seniors
          </a>{" "}
          — free one-to-one help with phones, tablets, and computers for people over 65.
          Started in the Wairarapa in 2018 and runs weekly drop-in hubs in libraries and
          community halls; home visits can be arranged locally. Phone 0800 373 646 to find
          the nearest hub, or email contact@digitalseniors.co.nz
        </li>
        <li>
          <a href="https://fcc.nz/community-groups" target="_blank" rel="noopener noreferrer">
            Wisdom and Wellbeing Group
          </a>{" "}
          — social morning for seniors at the Featherston Community Centre, Wednesdays
          10:30am–12pm, $4. Morning tea followed by guest speakers, activities, and occasional
          outings. Pick-ups from home can be arranged, and you'll be dropped home afterwards.
          Running for around 17 years. Contact info@fcc.nz
        </li>
        <li>
          <a href="https://menzshed.org.nz/featherston/" target="_blank" rel="noopener noreferrer">
            Featherston Menz Shed
          </a>{" "}
          — 61 Fitzherbert Street, on the main street by the town square. Open Tuesday and
          Thursday 10am–4pm and Sunday 1pm–4pm, with extensive woodworking equipment and a
          metal shop in the works. Membership is $20 a year and includes access to the
          Carterton, Martinborough, and Henley (Masterton) sheds. Phone 027 450 0660
        </li>
        <li>
          <a href="https://www.ageconcernwai.org.nz/" target="_blank" rel="noopener noreferrer">
            Age Concern Wairarapa
          </a>{" "}
          — visiting service, elder abuse response, exercise classes (Steady As You Go, keep
          fit, line dancing), social outings, driver support, and advocacy. Coffee morning and
          outreach at the Featherston Community Centre, 14 Wakefield Street, on the fourth
          Wednesday of each month, 11am–1pm. Office at 14B Queen Street, Masterton 5810,
          open Monday to Friday 9am–3pm. Phone 06 377 0066 or email admin@acww.nz
        </li>
        <li>
          <a href="https://www.masonicvillages.co.nz/meals-on-wheels/" target="_blank" rel="noopener noreferrer">
            South Wairarapa Meals on Wheels
          </a>{" "}
          — hot main and dessert delivered to your door on weekdays in Featherston, run by
          Masonic Villages. Helpful while recovering from illness or if getting to the shops
          is difficult. Phone 06 306 9701 or email mow@masonicvillages.co.nz
        </li>
      </ul>

      <h3>Local Places &amp; Services</h3>
      <ul>
        <li>
          <a href="https://swdc.govt.nz/services/venues/featherston-2/" target="_blank" rel="noopener noreferrer">
            Anzac Hall
          </a>{" "}
          — 62–64 Bell Street, on the corner of Bell and Birdwood Streets. Featherston's main
          hall, opened in 1916 as a recreation centre for troops at the nearby military camp,
          and still the venue for many local gatherings. The Anzac Hall, Kiwi Hall, and Supper
          Room seat groups from 20 up to 400, with kitchen access and a screen for
          presentations. Book through the council on 06 306 9611 or enquiries@swdc.govt.nz
        </li>
        <li>
          <a href="https://www.cab.org.nz/location/cab-wairarapa" target="_blank" rel="noopener noreferrer">
            Citizens Advice Bureau Wairarapa
          </a>{" "}
          — free, confidential advice on entitlements, tenancy, legal questions, and much
          else. The Wairarapa bureau is based in Masterton and covers Featherston; see the
          link for its current address and opening hours, or phone 0800 367 222 from
          anywhere in New Zealand
        </li>
        <li>
          <a href="https://swdc.govt.nz/services/libraries/" target="_blank" rel="noopener noreferrer">
            Featherston Library
          </a>{" "}
          — 70–72 Fitzherbert Street. A warm place to sit, read, and use a computer.
          Open Monday–Friday 9:30am–5pm, Saturday 9:30am–12pm
        </li>
        <li>
          <a href="https://swdc.govt.nz/" target="_blank" rel="noopener noreferrer">
            South Wairarapa District Council
          </a>{" "}
          — rates rebates for low-income households, community facilities, and local services
        </li>
        <li>
          See the <a href="/transport">Transport</a> page for getting to appointments in
          Greytown, Masterton, and Wellington, including SuperGold Card travel
        </li>
      </ul>

      <p>
        <em>
          Know of another local group or service for older residents? Please tell us using the
          form at the bottom of the <a href="/">home page</a>.
        </em>
      </p>
      </SiteEditablePage>
    </PageLayout>
  );
}
