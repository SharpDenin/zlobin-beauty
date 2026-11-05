package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinioCfg struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

func minioCfgFromEnv(prefix string) MinioCfg {
	useSSL, _ := strconv.ParseBool(envOr(prefix+"_MINIO_USE_SSL", "false"))
	return MinioCfg{
		Endpoint:  envOr(prefix+"_MINIO_ENDPOINT", ""),
		AccessKey: envOr(prefix+"_MINIO_ACCESS_KEY", ""),
		SecretKey: envOr(prefix+"_MINIO_SECRET_KEY", ""),
		Bucket:    envOr(prefix+"_MINIO_BUCKET", "zlobin-media"),
		UseSSL:    useSSL,
	}
}

func (c MinioCfg) validate(label string) error {
	if strings.TrimSpace(c.Endpoint) == "" {
		return fmt.Errorf("%s MinIO endpoint is empty", label)
	}
	if strings.TrimSpace(c.AccessKey) == "" || strings.TrimSpace(c.SecretKey) == "" {
		return fmt.Errorf("%s MinIO credentials are empty", label)
	}
	return nil
}

func openMinio(cfg MinioCfg) (*minio.Client, error) {
	return minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
}

func downloadObject(ctx context.Context, client *minio.Client, bucket, key, destPath string) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	obj, err := client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return err
	}
	defer obj.Close()
	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, obj)
	return err
}

func objectStat(ctx context.Context, client *minio.Client, bucket, key string) (minio.ObjectInfo, error) {
	return client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
}

func uploadObject(ctx context.Context, client *minio.Client, bucket, key, srcPath, contentType string) error {
	f, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, bucket, key, f, st.Size(), minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func mediaFilePath(dir string, m MediaRow) string {
	safe := strings.ReplaceAll(m.ObjectKey, "/", "__")
	return filepath.Join(dir, "objects", safe)
}
