# =============================================================================
# Frontend image — build with Node, serve with nginx.
#
# The output of a Vite build is static files. Shipping a Node process to serve
# them would waste ~50MB of RAM and add a runtime that can crash; nginx serves
# them from ~2MB with no application layer at all.
#
# Note: `VITE_API_BASE_URL` is a BUILD-time variable. Vite inlines it into the
# bundle, so it must be supplied as a build arg — setting it at container
# runtime has no effect.
# =============================================================================

# --- Stage 1: build ----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build


# --- Stage 2: serve ----------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
