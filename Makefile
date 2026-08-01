.PHONY: tidy test-backend up down bootstrap frontend-install frontend-dev

tidy:
	cd backend && go mod tidy

test-backend:
	cd backend && go test ./...

up:
	docker compose up -d --build postgres nats minio identity organizations marketplace booking gateway

down:
	docker compose down

bootstrap:
	docker compose --profile bootstrap run --rm bootstrap-admin

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev
