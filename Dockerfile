# WRS Raipur QC Platform — production image
# Builds the client into a static bundle, then runs the combined
# API + static-file server (server/src/app.ts serves client/dist directly).
#
# Requires Node 22+ (uses the native node:sqlite module and
# --experimental-strip-types to run TypeScript directly — no separate
# server compile step).

FROM node:22-slim AS client-builder
WORKDIR /app
COPY shared ./shared
COPY client ./client
WORKDIR /app/client
RUN npm install
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
COPY shared ./shared
COPY server ./server
COPY --from=client-builder /app/client/dist ./client/dist
WORKDIR /app/server
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# JWT_SECRET, DB_PATH, and CORS_ORIGIN are expected to be supplied at
# `docker run` / compose time — the server refuses to start in production
# without a real JWT_SECRET (see server/src/config/index.ts).
VOLUME ["/app/server/data"]

CMD ["node", "--experimental-strip-types", "src/index.ts"]
