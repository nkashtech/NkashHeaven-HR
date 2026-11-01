const webpush = require('web-push');
const prisma = require('./prisma');

const configured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const sendOptions = () => ({
  TTL: 45,
  urgency: 'high',
  vapidDetails: { subject: process.env.VAPID_SUBJECT || 'mailto:no-reply@nkashheaven.co.za', publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY },
});

// Reaches a closed tab or app through the browser's own push service. payloadFor gets each person's id, for links only they can use.
async function sendPush(userIds, payloadFor) {
  if (!configured() || !userIds.length) return;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  await Promise.all(subscriptions.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payloadFor(s.userId)), sendOptions());
    } catch (err) {
      // The browser dropped this subscription, so it can never be reached again.
      if ([404, 410].includes(err.statusCode)) await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
      else console.warn('push failed:', err.statusCode || err.message);
    }
  }));
}

module.exports = { sendPush, pushEnabled: configured };
