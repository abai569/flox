package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go-backend/internal/app"
	"go-backend/internal/config"
	"go-backend/internal/middleware"
	"go-backend/internal/store/repo"
)

const defaultLicenseServerURL = "https://sq.abai.eu.org"

func main() {
	cfg := config.FromEnv()
	if cfg.JWTSecret == "" {
		log.Println("warning: JWT_SECRET is empty")
	}

	// 容错逻辑 1：如果环境变量未配置授权，尝试从数据库回退读取
	// 这解决了升级或重启后 .env 丢失但数据库仍有配置的问题
	if cfg.LicenseKey == "" {
		log.Println(" 环境变量未配置授权，尝试从数据库恢复...")
		tempRepo, err := getTempRepository(cfg)
		if err == nil && tempRepo != nil {
			cfg1, _ := tempRepo.GetConfigByName("license_server_url")
			cfg2, _ := tempRepo.GetConfigByName("license_key")
			cfg3, _ := tempRepo.GetConfigByName("server_domain")
			tempRepo.Close()

			if cfg2 != nil && cfg2.Value != "" {
				cfg.LicenseKey = cfg2.Value
			}
			if cfg3 != nil && cfg3.Value != "" {
				middleware.UpdateServerDomainFromConfig(cfg3.Value)
			}
			if cfg1 != nil && cfg1.Value != "" {
				cfg.LicenseServerURL = cfg1.Value
			} else if cfg.LicenseKey != "" {
				// 如果只有 key 没有 url，使用默认值
				cfg.LicenseServerURL = defaultLicenseServerURL
				log.Println("ℹ️  数据库中未找到授权服务器地址，使用默认值")
			}
			if cfg.LicenseKey != "" {
				log.Println("✅ 授权配置已从数据库恢复")
			}
		}
	}

	// 授权验证
	if cfg.LicenseServerURL != "" && cfg.LicenseKey != "" {
		log.Printf("🔐 开始验证授权...")
		domain := middleware.GetServerDomain()
		if err := middleware.StartLicenseVerification(cfg.LicenseServerURL, cfg.LicenseKey, domain, domain, "https:"); err != nil {
			log.Printf("⚠️  授权验证失败：%v", err)
		} else {
			valid, expireTime, reason, _ := middleware.GetLicenseState()
			if valid {
				log.Printf("✅ 授权验证成功，有效期至：%s", time.UnixMilli(expireTime).Format("2006-01-02"))
			} else {
				log.Printf("⚠️  授权无效：%s", reason)
			}
		}
	} else {
		log.Println("⚠️  未配置授权服务，将进入体验模式")
	}

	log.Printf("starting go-backend on %s (db=%s, version=%s)", cfg.Addr, cfg.DBPath, cfg.FloxVersion)

	a, err := app.New(cfg)
	if err != nil {
		log.Fatalf("failed to create app: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- a.Run()
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("received signal %s, shutting down", sig)
	case runErr := <-errCh:
		if runErr != nil && !errors.Is(runErr, http.ErrServerClosed) {
			log.Fatalf("server stopped unexpectedly: %v", runErr)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown failed: %v", err)
	}
}

func getTempRepository(cfg config.Config) (*repo.Repository, error) {
	dialectorType := strings.ToLower(strings.TrimSpace(cfg.DBType))
	switch dialectorType {
	case "", "sqlite":
		return repo.Open(cfg.DBPath)
	case "postgres", "postgresql":
		return repo.OpenPostgres(cfg.DatabaseURL)
	}
	return nil, nil
}
