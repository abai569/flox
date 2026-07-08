package model

import "time"

type MimicConfig struct {
	ID                int64     `gorm:"primaryKey"`
	ForwardID         int64     `gorm:"uniqueIndex;not null"`
	MimicPort         int       `gorm:"not null;default:44445"`
	WgInterface       string    `gorm:"not null;default:wg0"`
	WgAddress         string    `gorm:"not null"`
	WgPrivateKey      string    `gorm:"not null"`
	WgPublicKey       string    `gorm:"not null"`
	ServerPublicIP    string
	ServerPublicKey   string
	ServerPrivateKey  string
	ServerWgAddress   string
	ClientPublicKey   string
	Status            int       `gorm:"default:0"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (MimicConfig) TableName() string { return "mimic_configs" }
