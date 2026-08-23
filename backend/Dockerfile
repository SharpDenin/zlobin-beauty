FROM golang:1.26-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG SERVICE_PATH
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/service ./$SERVICE_PATH

FROM alpine:3.21
RUN adduser -D -H -u 10001 appuser && apk add --no-cache ca-certificates tzdata wget
USER appuser
WORKDIR /app
COPY --from=build /out/service /app/service
EXPOSE 8080
ENTRYPOINT ["/app/service"]
