import { defineRailway, github, preserve, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "backend";

export default defineRailway(() => {
  const backend = service("backend", {
    source: github("gagandeepchauhan/uniblox-checkout-rewards"),
    start: "npm start --workspace backend",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    preDeploy: "npm run migrate",
    env: {
      NODE_ENV: preserve(),
      DB_HOST: preserve(),
      DB_PORT: preserve(),
      DB_NAME: preserve(),
      DB_USER: preserve(),
      DB_PASSWORD: preserve(),
      DB_POOL_MIN: preserve(),
      DB_POOL_MAX: preserve(),
      COUPON_ORDER_INTERVAL: preserve(),
      COUPON_DISCOUNT_PERCENT: preserve(),
      FRONTEND_ORIGIN: preserve(),
    },
  });
  return project("uniblox-checkout-rewards", {
    resources: [backend],
  });
});
