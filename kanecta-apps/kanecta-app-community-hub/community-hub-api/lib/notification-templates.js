// Notification message templates — edit here to customise what users receive.
//
// Each function receives data from the triggering action and returns
// { title, body, url } for the push notification payload.
//
// Rules:
//   - Notifications fire only for actions by OTHER users, never the initiating user.
//   - Only meaningful database-persisted actions trigger a notification.
//   - Keep `body` under ~100 characters for comfortable reading on a lock screen.

export const notify = {

  // Fired when any user submits a new event.
  // Recipients: all opted-in users (category: events), excluding the submitter.
  eventCreated: ({ title, description }) => ({
    title: `New event: ${title}`,
    body: description.slice(0, 100),
    url: "/events",
  }),

  // Fired when a team member creates a new discussion thread.
  // Recipients: all opted-in team members (category: discussions), excluding the creator.
  discussionThreadCreated: ({ threadName, authorName, description }) => ({
    title: `New thread: ${threadName}`,
    body: description ? `${authorName}: ${description.slice(0, 80)}` : `${authorName} started a thread`,
    url: "/discussions",
  }),

  // Fired when a team member posts a message in a thread.
  // Recipients: all opted-in users (category: discussions), excluding the poster.
  discussionMessage: ({ threadName, authorName, content, threadId }) => ({
    title: `#${threadName}`,
    body: `${authorName}: ${content.slice(0, 100)}`,
    url: `/discussions#${threadId}`,
  }),

  // Fired when any logged-in user submits a suggestion.
  // Recipients: all opted-in users (category: suggestions), excluding the submitter.
  suggestionCreated: ({ authorName, content }) => ({
    title: `New suggestion from ${authorName || "a member"}`,
    body: content.slice(0, 100),
    url: "/governance/suggestions",
  }),

  // Fired when a team member publishes a page (transitions from draft to public).
  // Recipients: all opted-in users (category: pages), excluding the publisher.
  pagePublished: ({ title, authorName, slug }) => ({
    title: `New page: ${title}`,
    body: `Published by ${authorName}`,
    url: `/pages/${slug}`,
  }),

};
