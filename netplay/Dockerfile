# RunThemAll netplay relay: a static binary in an empty image.
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /netplay .

FROM scratch
COPY --from=build /netplay /netplay
EXPOSE 8090
USER 65534
ENTRYPOINT ["/netplay"]
