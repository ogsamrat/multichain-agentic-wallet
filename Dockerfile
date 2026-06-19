# Prism Index registry — container image.
# Build from the repo root:  docker build -t prism-index .
# Run:                       docker run -p 8787:8787 prism-index
FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN HUSKY=0 npm install --no-audit --no-fund
RUN npm run build

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=build /repo /repo
EXPOSE 8787
CMD ["node", "apps/index/dist/server.js"]
