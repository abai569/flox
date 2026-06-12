package repo

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"go-backend/internal/store/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errAutoBuyTrafficPackageInvalid = errors.New("自动购流套餐不可用")

func (r *Repository) UserExists(username string) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var cnt int64
	err := r.db.Model(&model.User{}).Where(`"user" = ?`, username).Count(&cnt).Error
	return cnt > 0, err
}

func (r *Repository) UserExistsExcluding(username string, excludeID int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var cnt int64
	err := r.db.Model(&model.User{}).
		Where(`"user" = ? AND id != ?`, username, excludeID).
		Count(&cnt).Error
	return cnt > 0, err
}

func (r *Repository) CreateUser(username, pwdHash string, roleID int, expTime, flow, flowResetTime int64, num, status int, now int64, renewalAmount, balance, autoRenew int64) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	user := model.User{
		User:          username,
		Pwd:           pwdHash,
		RoleID:        roleID,
		ExpTime:       expTime,
		Flow:          flow,
		InFlow:        0,
		OutFlow:       0,
		FlowResetTime: flowResetTime,
		Num:           num,
		CreatedTime:   now,
		UpdatedTime:   sql.NullInt64{Int64: now, Valid: true},
		Status:        status,
		RenewalAmount: renewalAmount,
		Balance:       balance,
		AutoRenew:     int(autoRenew),
		BaseFlow:      flow,
	}
	if err := r.db.Create(&user).Error; err != nil {
		return 0, err
	}
	return user.ID, nil
}

func (r *Repository) GetUserRoleID(userID int64) (int, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	var user model.User
	err := r.db.Select("role_id").Where("id = ?", userID).First(&user).Error
	if err != nil {
		return 0, normalizeNotFoundErr(err)
	}
	return user.RoleID, nil
}

func (r *Repository) UpdateUserWithPassword(id int64, username, pwdHash, name string, flow int64, num int, expTime, flowResetTime int64, status int, now int64, renewalAmount, balance, autoRenew int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	// 使用 Select 强制更新所有字段，包括零值
	return r.db.Model(&model.User{}).
		Where("id = ?", id).
		Select("user", "name", "pwd", "flow", "num", "exp_time", "flow_reset_time", "status", "updated_time", "renewal_amount", "balance", "auto_renew").
		Updates(map[string]interface{}{
			"user":            username,
			"name":            name,
			"pwd":             pwdHash,
			"flow":            flow,
			"num":             num,
			"exp_time":        expTime,
			"flow_reset_time": flowResetTime,
			"status":          status,
			"updated_time":    sql.NullInt64{Int64: now, Valid: true},
			"renewal_amount":  renewalAmount,
			"balance":         balance,
			"auto_renew":      autoRenew,
		}).Error
}

func (r *Repository) UpdateUserWithoutPassword(id int64, username, name string, flow int64, num int, expTime, flowResetTime int64, status int, now int64, renewalAmount, balance, autoRenew int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	// 使用 Select 强制更新所有字段，包括零值
	return r.db.Model(&model.User{}).
		Where("id = ?", id).
		Select("user", "name", "flow", "num", "exp_time", "flow_reset_time", "status", "updated_time", "renewal_amount", "balance", "auto_renew").
		Updates(map[string]interface{}{
			"user":            username,
			"name":            name,
			"flow":            flow,
			"num":             num,
			"exp_time":        expTime,
			"flow_reset_time": flowResetTime,
			"status":          status,
			"updated_time":    sql.NullInt64{Int64: now, Valid: true},
			"renewal_amount":  renewalAmount,
			"balance":         balance,
			"auto_renew":      autoRenew,
		}).Error
}

func (r *Repository) PropagateUserFlowToTunnels(userID int64, flow int64, num int, expTime, flowResetTime int64, status int) {
	if r == nil || r.db == nil {
		return
	}
	_ = r.db.Model(&model.UserTunnel{}).
		Where("user_id = ?", userID).
		Updates(map[string]interface{}{
			"flow":            flow,
			"num":             num,
			"exp_time":        expTime,
			"flow_reset_time": flowResetTime,
			"status":          status,
		}).Error
}

func (r *Repository) DeleteUserCascade(userID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		forwardIDs := tx.Model(&model.Forward{}).Select("id").Where("user_id = ?", userID)
		if err := tx.Where("forward_id IN (?)", forwardIDs).Delete(&model.ForwardPort{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&model.Forward{}).Error; err != nil {
			return err
		}
		userTunnelIDs := tx.Model(&model.UserTunnel{}).Select("id").Where("user_id = ?", userID)
		if err := tx.Where("user_tunnel_id IN (?)", userTunnelIDs).Delete(&model.GroupPermissionGrant{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserTunnel{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserGroupUser{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&model.StatisticsFlow{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserQuota{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", userID).Delete(&model.User{}).Error
	})
}

func (r *Repository) ResetUserFlowByUser(userID int64, now int64) {
	if r == nil || r.db == nil {
		return
	}

	var user model.User
	var quota model.UserQuota

	if err := r.db.Where("id = ?", userID).First(&user).Error; err != nil {
		return
	}

	_ = r.db.Where("user_id = ?", userID).First(&quota).Error

	inFlowBefore := user.InFlow
	outFlowBefore := user.OutFlow
	totalBytes := inFlowBefore + outFlowBefore

	tx := r.db.Begin()
	defer func() { tx.Rollback() }()

	_ = tx.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"in_flow":      0,
			"out_flow":     0,
			"updated_time": sql.NullInt64{Int64: now, Valid: true},
		}).Error

	_ = tx.Model(&model.UserQuota{}).
		Where("user_id = ?", userID).
		Updates(map[string]interface{}{
			"monthly_used_bytes": 0,
			"updated_time":       now,
		}).Error

	history := &model.UserQuotaHistory{
		UserID:        userID,
		PeriodType:    "monthly",
		PeriodKey:     quota.MonthKey,
		InFlowBefore:  inFlowBefore,
		OutFlowBefore: outFlowBefore,
		UsedBytes:     totalBytes,
		ResetTime:     now,
		CreatedTime:   now,
		ResetReason:   "管理员手动归零",
	}
	_ = tx.Create(history).Error

	_ = tx.Model(&model.UserTunnel{}).
		Where("user_id = ?", userID).
		Updates(map[string]interface{}{"in_flow": 0, "out_flow": 0}).Error

	tx.Commit()
}

func (r *Repository) ResetUserFlowByUserTunnel(userTunnelID int64) {
	if r == nil || r.db == nil {
		return
	}
	// 查询归零前的流量
	var utFlow struct {
		InFlow  int64
		OutFlow int64
		UserID  int64
	}
	r.db.Model(&model.UserTunnel{}).Select("in_flow", "out_flow", "user_id").Where("id = ?", userTunnelID).First(&utFlow)

	_ = r.db.Model(&model.UserTunnel{}).
		Where("id = ?", userTunnelID).
		Updates(map[string]interface{}{"in_flow": 0, "out_flow": 0}).Error

	// 记录隧道流量归零历史
	if utFlow.InFlow > 0 || utFlow.OutFlow > 0 {
		var user model.User
		var tunnel model.Tunnel
		r.db.Model(&model.User{}).Select("user", "name").Where("id = ?", utFlow.UserID).First(&user)

		var userTunnel model.UserTunnel
		r.db.Model(&model.UserTunnel{}).Select("tunnel_id").Where("id = ?", userTunnelID).First(&userTunnel)
		r.db.Model(&model.Tunnel{}).Select("name").Where("id = ?", userTunnel.TunnelID).First(&tunnel)

		totalBytes := utFlow.InFlow + utFlow.OutFlow
		history := model.UserQuotaHistory{
			UserID:        utFlow.UserID,
			PeriodType:    "tunnel",
			PeriodKey:     userTunnel.TunnelID,
			InFlowBefore:  utFlow.InFlow,
			OutFlowBefore: utFlow.OutFlow,
			UsedBytes:     totalBytes,
			ResetTime:     time.Now().UnixMilli(),
			CreatedTime:   time.Now().UnixMilli(),
			ResetReason:   "管理员手动归零",
		}
		r.db.Create(&history)
	}
}

func (r *Repository) GetUsernameByID(userID int64) string {
	if r == nil || r.db == nil {
		return ""
	}
	var user model.User
	if err := r.db.Select("user").Where("id = ?", userID).First(&user).Error; err != nil {
		return ""
	}
	return user.User
}

func (r *Repository) GetUserDefaultsForTunnel(userID int64) (flow int64, num int, expTime int64, flowReset int64, err error) {
	if r == nil || r.db == nil {
		return 0, 0, 0, 0, errors.New("repository not initialized")
	}
	var user model.User
	err = r.db.Select("flow", "num", "exp_time", "flow_reset_time").Where("id = ?", userID).First(&user).Error
	if err != nil {
		return 0, 0, 0, 0, normalizeNotFoundErr(err)
	}
	return user.Flow, user.Num, user.ExpTime, user.FlowResetTime, nil
}

func (r *Repository) CreateNode(name, secret, serverIP string, serverIPV4, serverIPV6, port, interfaceName, version, remark, expiryTime, renewalCycle, groupID interface{}, httpFlag, tlsFlag, socksFlag, blockOtherFlag int, now int64, status int, tcpAddr, udpAddr string, inx, isRemote int, remoteURL, remoteToken, remoteConfig, extraIPs interface{}, trafficLimit int64, flowResetTime int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if flowResetTime <= 0 {
		flowResetTime = 1
	}
	node := model.Node{
		Name:          name,
		Remark:        nullStringFromInterface(remark),
		ExpiryTime:    nullInt64FromInterface(expiryTime),
		RenewalCycle:  nullStringFromInterface(renewalCycle),
		GroupID:       nullInt64FromInterface(groupID),
		Secret:        secret,
		ServerIP:      serverIP,
		ServerIPV4:    nullStringFromInterface(serverIPV4),
		ServerIPV6:    nullStringFromInterface(serverIPV6),
		ExtraIPs:      nullStringFromInterface(extraIPs),
		Port:          stringFromInterface(port),
		InterfaceName: nullStringFromInterface(interfaceName),
		Version:       nullStringFromInterface(version),
		HTTP:          httpFlag,
		TLS:           tlsFlag,
		Socks:         socksFlag,
		BlockOther:    blockOtherFlag,
		CreatedTime:   now,
		UpdatedTime:   sql.NullInt64{Int64: now, Valid: true},
		Status:        status,
		TCPListenAddr: tcpAddr,
		UDPListenAddr: udpAddr,
		Inx:           inx,
		IsRemote:      isRemote,
		RemoteURL:     nullStringFromInterface(remoteURL),
		RemoteToken:   nullStringFromInterface(remoteToken),
		RemoteConfig:  nullStringFromInterface(remoteConfig),
		TrafficLimit:  trafficLimit,
		FlowResetTime: flowResetTime,
	}
	return r.db.Create(&node).Error
}

func (r *Repository) GetNodeStatusFields(nodeID int64) (status, httpFlag, tlsFlag, socksFlag, blockOtherFlag int, err error) {
	if r == nil || r.db == nil {
		return 0, 0, 0, 0, 0, errors.New("repository not initialized")
	}
	var node model.Node
	err = r.db.Select("status", "http", "tls", "socks", "block_other").Where("id = ?", nodeID).First(&node).Error
	if err != nil {
		return 0, 0, 0, 0, 0, normalizeNotFoundErr(err)
	}
	return node.Status, node.HTTP, node.TLS, node.Socks, node.BlockOther, nil
}

// UpdateNodePublicIP 更新节点公网 IP
func (r *Repository) UpdateNodePublicIP(nodeID int64, publicIP string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Node{}).
		Where("id = ?", nodeID).
		Update("server_ip", publicIP).Error
}

func (r *Repository) UpdateNodePublicIPs(nodeID int64, ipv4, ipv6 string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	serverIP := ipv6
	if serverIP == "" {
		serverIP = ipv4
	}
	return r.db.Model(&model.Node{}).
		Where("id = ?", nodeID).
		Updates(map[string]interface{}{
			"server_ip":    serverIP,
			"server_ip_v4": ipv4,
			"server_ip_v6": ipv6,
		}).Error
}

func (r *Repository) UpdateNode(id int64, name, serverIP string, serverIPV4, serverIPV6, intranetIP, port, interfaceName, extraIPs, remark, expiryTime, renewalCycle, groupID, secret interface{}, httpFlag, tlsFlag, socksFlag, blockOtherFlag int, tcpAddr, udpAddr string, now int64, trafficLimit int64, flowResetTime int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	updates := map[string]interface{}{
		"name":                      name,
		"remark":                    nullStringFromInterface(remark),
		"expiry_time":               nullInt64FromInterface(expiryTime),
		"renewal_cycle":             nullStringFromInterface(renewalCycle),
		"server_ip":                 serverIP,
		"server_ip_v4":              nullStringFromInterface(serverIPV4),
		"server_ip_v6":              nullStringFromInterface(serverIPV6),
		"intranet_ip":               nullStringFromInterface(intranetIP),
		"extra_ips":                 nullStringFromInterface(extraIPs),
		"port":                      stringFromInterface(port),
		"interface_name":            nullStringFromInterface(interfaceName),
		"http":                      httpFlag,
		"tls":                       tlsFlag,
		"socks":                     socksFlag,
		"block_other":               blockOtherFlag,
		"tcp_listen_addr":           tcpAddr,
		"udp_listen_addr":           udpAddr,
		"updated_time":              sql.NullInt64{Int64: now, Valid: true},
		"expiry_reminder_dismissed": 0,
		"traffic_limit":             trafficLimit,
		"flow_reset_time":           flowResetTime,
	}
	if groupID != nil {
		updates["group_id"] = groupID
	} else {
		updates["group_id"] = sql.NullInt64{Int64: 0, Valid: false}
	}
	if s, ok := secret.(string); ok && s != "" {
		updates["secret"] = s
	}
	return r.db.Model(&model.Node{}).
		Where("id = ?", id).
		Updates(updates).Error
}

func (r *Repository) GetNodeSecret(nodeID int64) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("repository not initialized")
	}
	var node model.Node
	err := r.db.Select("secret").Where("id = ?", nodeID).First(&node).Error
	if err != nil {
		return "", normalizeNotFoundErr(err)
	}
	return node.Secret, nil
}

func (r *Repository) GetNodeName(nodeID int64) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("repository not initialized")
	}
	var node model.Node
	err := r.db.Select("name").Where("id = ?", nodeID).First(&node).Error
	if err != nil {
		return "", normalizeNotFoundErr(err)
	}
	return node.Name, nil
}

func (r *Repository) GetNodeNameTx(tx *gorm.DB, nodeID int64) (string, error) {
	if tx == nil {
		return "", errors.New("database unavailable")
	}
	var node model.Node
	err := tx.Select("name").Where("id = ?", nodeID).First(&node).Error
	if err != nil {
		return "", normalizeNotFoundErr(err)
	}
	return node.Name, nil
}

func (r *Repository) GetViteConfigValue(name string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("repository not initialized")
	}

	// 先尝试新配置项名称
	var cfg model.ViteConfig
	err := r.db.Select("value").Where("name = ?", name).First(&cfg).Error
	if err == nil && cfg.Value != "" {
		return cfg.Value, nil
	}

	// 尝试旧配置项名称（向后兼容）
	oldName := getOldConfigName(name)
	if oldName != "" {
		err = r.db.Select("value").Where("name = ?", oldName).First(&cfg).Error
		if err == nil && cfg.Value != "" {
			return cfg.Value, nil
		}
	}

	return "", normalizeNotFoundErr(err)
}

// getOldConfigName 返回旧配置项名称（用于向后兼容）
func getOldConfigName(newName string) string {
	switch newName {
	case "global_download_url":
		return "ghfast_url"
	case "domestic_download_url":
		return "domestic_download_host"
	default:
		return ""
	}
}

func (r *Repository) UpdateNodeOrder(nodeID int64, inx int, now int64) {
	if r == nil || r.db == nil {
		return
	}
	_ = r.db.Model(&model.Node{}).
		Where("id = ?", nodeID).
		Updates(map[string]interface{}{
			"inx":          inx,
			"updated_time": sql.NullInt64{Int64: now, Valid: true},
		}).Error
}

func (r *Repository) UpdateUserOrder(userID int64, inx int, now int64) {
	if r == nil || r.db == nil {
		return
	}
	_ = r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"inx":          inx,
			"updated_time": sql.NullInt64{Int64: now, Valid: true},
		}).Error
}

func (r *Repository) UpdateUserAutoRenew(userID int64, autoRenew int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Update("auto_renew", autoRenew).Error
}

func (r *Repository) UpdateUserAutoBuyTraffic(userID int64, autoBuyTraffic int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Update("auto_buy_traffic", autoBuyTraffic).Error
}

func (r *Repository) BuyTrafficWithBalance(userID, buyPrice, buyAmount, flowBefore, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	user, err := r.GetUserByID(userID)
	if err != nil {
		return err
	}
	if user.Balance < buyPrice {
		return errors.New("insufficient balance")
	}

	tx := r.db.Begin()
	defer func() { tx.Rollback() }()

	newFlow := user.Flow + buyAmount
	err = tx.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"balance":      user.Balance - buyPrice,
			"flow":         newFlow,
			"traffic_flow": gorm.Expr("traffic_flow + ?", buyAmount),
			"updated_time": sql.NullInt64{Int64: now, Valid: true},
		}).Error
	if err != nil {
		return err
	}

	log := &model.UserTrafficBuyLog{
		UserID:        userID,
		UserName:      user.User,
		BuyAmount:     buyAmount,
		BuyPrice:      buyPrice,
		BalanceBefore: user.Balance,
		BalanceAfter:  user.Balance - buyPrice,
		FlowBefore:    flowBefore,
		FlowAfter:     newFlow,
		BuyTime:       now,
		Reason:        "自动购买流量",
	}
	err = tx.Create(log).Error
	if err != nil {
		return err
	}

	balanceLog := &model.BalanceLog{
		UserID:        userID,
		UserName:      user.User,
		Amount:        -buyPrice,
		BalanceBefore: user.Balance,
		BalanceAfter:  user.Balance - buyPrice,
		Reason:        "自动购买流量",
		CreatedTime:   now,
		Signature:     SignBalanceLog(userID, -buyPrice, user.Balance, user.Balance-buyPrice, now, "自动购买流量"),
	}
	err = tx.Create(balanceLog).Error
	if err != nil {
		return err
	}

	return tx.Commit().Error
}

func (r *Repository) BuyTrafficPackageWithBalance(userID, packageID, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	return r.db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}

		var pkg model.SubscriptionPackage
		if err := tx.Where("id = ?", packageID).First(&pkg).Error; err != nil {
			return errAutoBuyTrafficPackageInvalid
		}
		if pkg.Type != "traffic" || pkg.AutoBuyTrafficEnabled != 1 || pkg.Enabled != 1 || pkg.TrafficLimit <= 0 || pkg.Price <= 0 {
			return errAutoBuyTrafficPackageInvalid
		}
		if user.Balance < pkg.Price {
			return errors.New("insufficient balance")
		}

		if pkg.Stock != -1 {
			result := tx.Model(&model.SubscriptionPackage{}).
				Where("id = ? AND stock >= ?", pkg.ID, 1).
				Update("stock", gorm.Expr("stock - ?", 1))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return errors.New("库存不足")
			}
		}

		newFlow := user.Flow + pkg.TrafficLimit
		if err := tx.Model(&model.User{}).
			Where("id = ?", userID).
			Updates(map[string]interface{}{
				"balance":      user.Balance - pkg.Price,
				"flow":         newFlow,
				"traffic_flow": gorm.Expr("traffic_flow + ?", pkg.TrafficLimit),
				"updated_time": sql.NullInt64{Int64: now, Valid: true},
			}).Error; err != nil {
			return err
		}

		buyLog := &model.UserTrafficBuyLog{
			UserID:        userID,
			UserName:      user.User,
			BuyAmount:     pkg.TrafficLimit,
			BuyPrice:      pkg.Price,
			BalanceBefore: user.Balance,
			BalanceAfter:  user.Balance - pkg.Price,
			FlowBefore:    user.Flow,
			FlowAfter:     newFlow,
			BuyTime:       now,
			Reason:        "自动购买流量",
		}
		if err := tx.Create(buyLog).Error; err != nil {
			return err
		}

		balanceLog := &model.BalanceLog{
			UserID:        userID,
			UserName:      user.User,
			Amount:        -pkg.Price,
			BalanceBefore: user.Balance,
			BalanceAfter:  user.Balance - pkg.Price,
			Reason:        "自动购买流量",
			CreatedTime:   now,
			Signature:     SignBalanceLog(userID, -pkg.Price, user.Balance, user.Balance-pkg.Price, now, "自动购买流量"),
		}
		return tx.Create(balanceLog).Error
	})
}

// CreateBalanceLog inserts a signed balance log entry.
func (r *Repository) CreateBalanceLog(userID int64, userName string, amount, balanceBefore, balanceAfter, now int64, reason string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	entry := &model.BalanceLog{
		UserID:        userID,
		UserName:      userName,
		Amount:        amount,
		BalanceBefore: balanceBefore,
		BalanceAfter:  balanceAfter,
		Reason:        reason,
		CreatedTime:   now,
		Signature:     SignBalanceLog(userID, amount, balanceBefore, balanceAfter, now, reason),
	}
	return r.db.Create(entry).Error
}

// RecalculateBalance computes a user's balance by summing all balance_log entries.
// Returns (sum, error). The returned sum is the authoritative balance.
func (r *Repository) RecalculateBalance(userID int64) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}

	var sum struct {
		Total int64
	}
	err := r.db.Model(&model.BalanceLog{}).
		Select("COALESCE(SUM(amount), 0) AS total").
		Where("user_id = ?", userID).
		Scan(&sum).Error
	if err != nil {
		return 0, err
	}
	return sum.Total, nil
}

// VerifyBalanceSignatures checks all balance_log entries with non-empty signatures.
// Returns a list of entries with invalid signatures.
func (r *Repository) VerifyBalanceSignatures() ([]model.BalanceLog, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var entries []model.BalanceLog
	err := r.db.Where("signature != ''").Order("id ASC").Find(&entries).Error
	if err != nil {
		return nil, err
	}

	var invalid []model.BalanceLog
	for _, entry := range entries {
		if !VerifyBalanceLogSignature(&entry) {
			invalid = append(invalid, entry)
		}
	}
	return invalid, nil
}

// VerifyAllBalances checks that user.balance matches the SUM of balance_log entries.
// Returns a list of (userID, dbBalance, logSum) for mismatches.
func (r *Repository) VerifyAllBalances() ([]interface{}, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var users []model.User
	err := r.db.Select("id, user, balance").Find(&users).Error
	if err != nil {
		return nil, err
	}

	var mismatches []interface{}
	for _, u := range users {
		logSum, err := r.RecalculateBalance(u.ID)
		if err != nil {
			continue
		}
		if u.Balance != logSum {
			mismatches = append(mismatches, map[string]int64{
				"user_id":    u.ID,
				"db_balance": u.Balance,
				"log_sum":    logSum,
				"diff":       u.Balance - logSum,
			})
		}
	}
	return mismatches, nil
}

func (r *Repository) UpdateUserBuyTrafficConfig(userID int64, autoBuyTraffic int, buyTrafficAmount, buyTrafficPrice, autoBuyTrafficPackageID, autoBuyTrafficThreshold int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).Where("id = ?", userID).
		Updates(map[string]interface{}{
			"auto_buy_traffic":            autoBuyTraffic,
			"buy_traffic_amount":          buyTrafficAmount,
			"buy_traffic_price":           buyTrafficPrice,
			"auto_buy_traffic_package_id": autoBuyTrafficPackageID,
			"auto_buy_traffic_threshold":  autoBuyTrafficThreshold,
		}).Error
}

func (r *Repository) ValidateAutoBuyTrafficConfig(autoBuyTraffic int, buyTrafficAmount, buyTrafficPrice, autoBuyTrafficPackageID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if autoBuyTraffic == 0 {
		return nil
	}
	if autoBuyTrafficPackageID > 0 {
		pkg, err := r.GetPackageByID(autoBuyTrafficPackageID)
		if err != nil {
			return errAutoBuyTrafficPackageInvalid
		}
		if pkg.Type != "traffic" || pkg.AutoBuyTrafficEnabled != 1 || pkg.Enabled != 1 {
			return errAutoBuyTrafficPackageInvalid
		}
		return nil
	}
	if buyTrafficAmount <= 0 || buyTrafficPrice <= 0 {
		return errors.New("自动购流自定义配置无效")
	}
	return nil
}

func (r *Repository) ResetUserFlowToBase(userID, baseFlow, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"flow":         baseFlow,
			"in_flow":      0,
			"out_flow":     0,
			"updated_time": sql.NullInt64{Int64: now, Valid: true},
		}).Error
}

func (r *Repository) ListAutoBuyTrafficCandidates(nowMs int64) ([]model.User, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var users []model.User
	err := r.db.Where("status = 1 AND (exp_time = 0 OR exp_time > ?) AND auto_buy_traffic = 1 AND ((auto_buy_traffic_package_id > 0) OR (buy_traffic_amount > 0 AND buy_traffic_price > 0))", nowMs).
		Find(&users).Error
	return users, err
}

func (r *Repository) UpdatePackageAutoBuyTrafficEnabled(packageID int64, enabled int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if err := r.db.Model(&model.SubscriptionPackage{}).Where("id = ?", packageID).
		Update("auto_buy_traffic_enabled", enabled).Error; err != nil {
		return err
	}
	if enabled == 0 {
		_ = r.db.Model(&model.User{}).Where("auto_buy_traffic_package_id = ?", packageID).
			Update("auto_buy_traffic_package_id", 0).Error
	}
	return nil
}

func (r *Repository) DisableUsersForZeroStockPackage(packageID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("auto_buy_traffic_package_id = ?", packageID).
		Update("auto_buy_traffic", 0).Error
}

func (r *Repository) UpdateUserAutoBuyTrafficPackage(userID int64, packageID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).Where("id = ?", userID).
		Update("auto_buy_traffic_package_id", packageID).Error
}

func (r *Repository) ListAutoBuyTrafficPackages() ([]*model.SubscriptionPackage, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var pkgs []*model.SubscriptionPackage
	err := r.db.Where("type = 'traffic' AND auto_buy_traffic_enabled = 1 AND enabled = 1").
		Order("sort_order ASC, id ASC").Find(&pkgs).Error
	return pkgs, err
}

func (r *Repository) RefreshNodeExpiryReminder(nodeID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	var node struct {
		RenewalCycle string        `gorm:"column:renewal_cycle"`
		ExpiryTime   sql.NullInt64 `gorm:"column:expiry_time"`
	}
	if err := r.db.Model(&model.Node{}).Where("id = ?", nodeID).Select("renewal_cycle, expiry_time").Find(&node).Error; err != nil {
		return err
	}

	if node.RenewalCycle == "" {
		return errors.New("renewal_cycle not set")
	}

	if !node.ExpiryTime.Valid || node.ExpiryTime.Int64 <= 0 {
		return errors.New("expiry_time not set")
	}

	now := time.Now()
	baseTime := time.UnixMilli(node.ExpiryTime.Int64)
	nextExpiry := baseTime

	intervalMonths := 0
	switch node.RenewalCycle {
	case "month":
		intervalMonths = 1
	case "quarter":
		intervalMonths = 3
	case "halfYear":
		intervalMonths = 6
	case "year":
		intervalMonths = 12
	default:
		intervalMonths = 1
	}

	// 从基准日期按周期推，找到第一个超过今天的日期
	for nextExpiry.Before(now) || nextExpiry.Equal(now) {
		nextExpiry = nextExpiry.AddDate(0, intervalMonths, 0)
	}

	// 用户主动点击更新，进入下一个周期
	nextExpiry = nextExpiry.AddDate(0, intervalMonths, 0)

	return r.db.Model(&model.Node{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"expiry_time":                     strconv.FormatInt(nextExpiry.UnixMilli(), 10),
		"expiry_reminder_dismissed":       0,
		"expiry_reminder_dismissed_until": 0,
	}).Error
}

func (r *Repository) UpdateNodeExpiryReminderDismissed(nodeID int64, dismissed int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Node{}).
		Where("id = ?", nodeID).
		Update("expiry_reminder_dismissed", dismissed).Error
}

// ListNodesExpiringWithin returns nodes whose expiry_time is within (now, now + days*24h]
// and either never reminded or last reminded > 24h ago.
func (r *Repository) ListNodesExpiringWithin(nowMs int64, days int) ([]model.Node, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	deadline := nowMs + int64(days)*86400000
	twentyFourHoursMs := int64(86400000)
	var nodes []model.Node
	if err := r.db.Where(
		"expiry_time IS NOT NULL AND expiry_time > ? AND expiry_time <= ? AND (expiry_reminder_dismissed_until IS NULL OR expiry_reminder_dismissed_until <= ? OR expiry_reminder_dismissed_until = 0)",
		0, deadline, nowMs-twentyFourHoursMs,
	).Find(&nodes).Error; err != nil {
		return nil, err
	}
	return nodes, nil
}

// UpdateNodeExpiryReminderDismissedUntil sets expiry_reminder_dismissed_until to prevent duplicate notifications within 24h.
func (r *Repository) UpdateNodeExpiryReminderDismissedUntil(nodeID int64, untilMs int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Node{}).
		Where("id = ?", nodeID).
		Update("expiry_reminder_dismissed_until", untilMs).Error
}

func (r *Repository) DeleteNodeCascade(nodeID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("node_id = ?", nodeID).Delete(&model.ForwardPort{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id = ?", nodeID).Delete(&model.ChainTunnel{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id = ?", nodeID).Delete(&model.FederationTunnelBinding{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", nodeID).Delete(&model.Node{}).Error
	})
}

func (r *Repository) GetNodeRemoteFields(nodeID int64) (isRemote int, remoteURL, remoteToken sql.NullString, err error) {
	if r == nil || r.db == nil {
		return 0, sql.NullString{}, sql.NullString{}, errors.New("repository not initialized")
	}
	return r.GetNodeRemoteFieldsTx(r.db, nodeID)
}

func (r *Repository) GetNodeRemoteFieldsTx(tx *gorm.DB, nodeID int64) (isRemote int, remoteURL, remoteToken sql.NullString, err error) {
	if tx == nil {
		return 0, sql.NullString{}, sql.NullString{}, errors.New("database unavailable")
	}
	var node model.Node
	err = tx.Select("is_remote", "remote_url", "remote_token").Where("id = ?", nodeID).First(&node).Error
	if err != nil {
		return 0, sql.NullString{}, sql.NullString{}, normalizeNotFoundErr(err)
	}
	return node.IsRemote, node.RemoteURL, node.RemoteToken, nil
}

func (r *Repository) GetNodePortRange(nodeID int64) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("repository not initialized")
	}
	var node model.Node
	err := r.db.Select("port").Where("id = ?", nodeID).First(&node).Error
	if err != nil {
		return "", normalizeNotFoundErr(err)
	}
	return node.Port, nil
}

func (r *Repository) TunnelNameExists(name string) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var cnt int64
	err := r.db.Model(&model.Tunnel{}).Where("name = ?", name).Count(&cnt).Error
	return cnt > 0, err
}

func (r *Repository) BeginTx() *gorm.DB {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Begin()
}

func (r *Repository) UpdateTunnelOrder(tunnelID int64, inx int, now int64) {
	if r == nil || r.db == nil {
		return
	}
	_ = r.db.Model(&model.Tunnel{}).
		Where("id = ?", tunnelID).
		Updates(map[string]interface{}{"inx": inx, "updated_time": now}).Error
}

func (r *Repository) UpdateTunnelTx(tx *gorm.DB, tunnelID int64, name string, typeVal int, flow int64, trafficRatio float64, status int, inIP, ipPreference string, listID int64, tunnelGroupID interface{}, remark string, now int64, httpVal, tlsVal, socksVal, blockOtherVal int, mode string) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	if mode == "" {
		mode = "gost"
	}
	updates := map[string]interface{}{
		"name":          name,
		"type":          typeVal,
		"flow":          flow,
		"traffic_ratio": trafficRatio,
		"status":        status,
		"in_ip":         nullStringFromInterface(inIP),
		"ip_preference": ipPreference,
		"updated_time":  now,
		"remark":        nullStringFromInterface(remark),
		"http":          httpVal,
		"tls":           tlsVal,
		"socks":         socksVal,
		"block_other":   blockOtherVal,
		"mode":          mode,
	}
	if listID > 0 {
		updates["list_id"] = sql.NullInt64{Int64: listID, Valid: true}
	} else {
		updates["list_id"] = sql.NullInt64{Int64: 0, Valid: false}
	}
	if tunnelGroupID != nil {
		if groupID, ok := tunnelGroupID.(int64); ok && groupID > 0 {
			updates["tunnel_group_id"] = sql.NullInt64{Int64: groupID, Valid: true}
		} else {
			updates["tunnel_group_id"] = sql.NullInt64{Int64: 0, Valid: false}
		}
	} else {
		updates["tunnel_group_id"] = sql.NullInt64{Int64: 0, Valid: false}
	}
	return tx.Model(&model.Tunnel{}).
		Where("id = ?", tunnelID).
		Updates(updates).Error
}

func (r *Repository) UpdateTunnelStatus(tunnelID int64, status int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Tunnel{}).
		Where("id = ?", tunnelID).
		Update("status", status).Error
}

func (r *Repository) DeleteChainTunnelsByTunnelTx(tx *gorm.DB, tunnelID int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	return tx.Where("tunnel_id = ?", tunnelID).Delete(&model.ChainTunnel{}).Error
}

func (r *Repository) CreateChainTunnelTx(tx *gorm.DB, tunnelID int64, chainType string, nodeID int64, port sql.NullInt64, strategy string, inx int, protocol string, connectIp string, connectIpType string) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	ct := model.ChainTunnel{
		TunnelID:      tunnelID,
		ChainType:     chainType,
		NodeID:        nodeID,
		Port:          port,
		Strategy:      nullStringFromInterface(strategy),
		Inx:           nullInt64FromInterface(inx),
		Protocol:      nullStringFromInterface(protocol),
		ConnectIP:     sql.NullString{String: connectIp, Valid: connectIp != ""},
		ConnectIPType: sql.NullString{String: connectIpType, Valid: connectIpType != ""},
	}
	return tx.Create(&ct).Error
}

func (r *Repository) UpdateChainTunnelConnectIpTypeTx(tx *gorm.DB, tunnelID int64, chainType string, nodeID int64, connectIpType string) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	return tx.Model(&model.ChainTunnel{}).
		Where("tunnel_id = ? AND chain_type = ? AND node_id = ?", tunnelID, chainType, nodeID).
		Update("connect_ip_type", connectIpType).Error
}

func (r *Repository) IsRemoteNodeTx(tx *gorm.DB, nodeID int64) (bool, error) {
	if tx == nil {
		return false, errors.New("database unavailable")
	}
	if nodeID <= 0 {
		return false, errors.New("节点不存在")
	}
	var node model.Node
	err := tx.Select("is_remote").Where("id = ?", nodeID).First(&node).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, errors.New("节点不存在")
	}
	if err != nil {
		return false, err
	}
	return node.IsRemote == 1, nil
}

func (r *Repository) PickNodePortTx(tx *gorm.DB, nodeID int64, allocated map[int64]int, excludeTunnelID int64) (int, error) {
	return r.pickNodePortTx(tx, nodeID, allocated, excludeTunnelID, false)
}

func (r *Repository) PickRandomNodePortTx(tx *gorm.DB, nodeID int64, allocated map[int64]int, excludeTunnelID int64) (int, error) {
	return r.pickNodePortTx(tx, nodeID, allocated, excludeTunnelID, true)
}

func (r *Repository) pickNodePortTx(tx *gorm.DB, nodeID int64, allocated map[int64]int, excludeTunnelID int64, randomPick bool) (int, error) {
	if tx == nil {
		return 0, errors.New("database unavailable")
	}
	if nodeID <= 0 {
		return 0, errors.New("节点不存在")
	}
	if port, ok := allocated[nodeID]; ok && port > 0 {
		return port, nil
	}

	var node model.Node
	err := tx.Select("port").Where("id = ?", nodeID).First(&node).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, errors.New("节点不存在")
	}
	if err != nil {
		return 0, err
	}

	candidates := parsePortRangeSpec(node.Port)
	if len(candidates) == 0 {
		nodeName, err := r.GetNodeNameTx(tx, nodeID)
		if err != nil || nodeName == "" {
			nodeName = fmt.Sprintf("节点#%d", nodeID)
		}
		return 0, fmt.Errorf("%s节点端口已满，无可用端口", nodeName)
	}

	used := make(map[int]struct{})

	chainQuery := tx.Model(&model.ChainTunnel{}).Where("node_id = ? AND port > 0", nodeID)
	if excludeTunnelID > 0 {
		chainQuery = chainQuery.Where("tunnel_id != ?", excludeTunnelID)
	}
	var chainPorts []int
	if err := chainQuery.Pluck("port", &chainPorts).Error; err != nil {
		return 0, err
	}
	for _, p := range chainPorts {
		if p > 0 {
			used[p] = struct{}{}
		}
	}

	var forwardPorts []int
	if err := tx.Model(&model.ForwardPort{}).
		Where("node_id = ? AND port > 0", nodeID).
		Pluck("port", &forwardPorts).Error; err != nil {
		return 0, err
	}
	for _, p := range forwardPorts {
		if p > 0 {
			used[p] = struct{}{}
		}
	}

	var available []int
	for _, candidate := range candidates {
		if candidate <= 0 {
			continue
		}
		if _, ok := used[candidate]; ok {
			continue
		}
		available = append(available, candidate)
	}

	if len(available) == 0 {
		nodeName, err := r.GetNodeNameTx(tx, nodeID)
		if err != nil || nodeName == "" {
			nodeName = fmt.Sprintf("节点#%d", nodeID)
		}
		return 0, fmt.Errorf("%s节点端口已满，无可用端口", nodeName)
	}
	if !randomPick {
		allocated[nodeID] = available[0]
		return available[0], nil
	}

	idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(available))))
	if err != nil {
		allocated[nodeID] = available[0]
		return available[0], nil
	}
	port := available[idx.Int64()]
	allocated[nodeID] = port
	return port, nil
}

func (r *Repository) GetTunnelIPPreference(tunnelID int64) string {
	if r == nil || r.db == nil {
		return ""
	}
	var tunnel model.Tunnel
	if err := r.db.Select("ip_preference").Where("id = ?", tunnelID).First(&tunnel).Error; err != nil {
		return ""
	}
	return tunnel.IPPreference
}

func (r *Repository) DeleteTunnelCascade(tunnelID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		forwardIDs := tx.Model(&model.Forward{}).Select("id").Where("tunnel_id = ?", tunnelID)
		if err := tx.Where("forward_id IN (?)", forwardIDs).Delete(&model.ForwardPort{}).Error; err != nil {
			return err
		}
		if err := tx.Where("tunnel_id = ?", tunnelID).Delete(&model.Forward{}).Error; err != nil {
			return err
		}
		userTunnelIDs := tx.Model(&model.UserTunnel{}).Select("id").Where("tunnel_id = ?", tunnelID)
		if err := tx.Where("user_tunnel_id IN (?)", userTunnelIDs).Delete(&model.GroupPermissionGrant{}).Error; err != nil {
			return err
		}
		if err := tx.Where("tunnel_id = ?", tunnelID).Delete(&model.UserTunnel{}).Error; err != nil {
			return err
		}
		if err := tx.Where("tunnel_id = ?", tunnelID).Delete(&model.ChainTunnel{}).Error; err != nil {
			return err
		}
		if err := tx.Where("tunnel_id = ?", tunnelID).Delete(&model.FederationTunnelBinding{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", tunnelID).Delete(&model.Tunnel{}).Error
	})
}

func (r *Repository) TunnelEntryNodeIDs(tunnelID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.ChainTunnel{}).
		Where("tunnel_id = ? AND chain_type = ?", tunnelID, "1").
		Order("inx ASC, id ASC").
		Pluck("node_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (r *Repository) DeleteUserTunnel(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("id = ?", id).Delete(&model.UserTunnel{}).Error
}

func (r *Repository) UpdateUserTunnel(id int64, flow int64, num int, expTime, flowResetTime int64, speedID interface{}, status int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.UserTunnel{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"flow":            flow,
			"num":             num,
			"exp_time":        expTime,
			"flow_reset_time": flowResetTime,
			"speed_id":        nullInt64FromInterface(speedID),
			"status":          status,
		}).Error
}

func (r *Repository) GetUserTunnelUserAndTunnel(id int64) (userID, tunnelID int64, err error) {
	if r == nil || r.db == nil {
		return 0, 0, errors.New("repository not initialized")
	}
	var ut model.UserTunnel
	err = r.db.Select("user_id", "tunnel_id").Where("id = ?", id).First(&ut).Error
	if err != nil {
		return 0, 0, normalizeNotFoundErr(err)
	}
	return ut.UserID, ut.TunnelID, nil
}

func (r *Repository) GetExistingUserTunnel(userID, tunnelID int64) (id int64, flow, num, expTime, flowReset int64, speedID sql.NullInt64, status int, err error) {
	if r == nil || r.db == nil {
		return 0, 0, 0, 0, 0, sql.NullInt64{}, 0, errors.New("repository not initialized")
	}
	var ut model.UserTunnel
	err = r.db.Select("id", "flow", "num", "exp_time", "flow_reset_time", "speed_id", "status").
		Where("user_id = ? AND tunnel_id = ?", userID, tunnelID).
		First(&ut).Error
	if err != nil {
		return 0, 0, 0, 0, 0, sql.NullInt64{}, 0, normalizeNotFoundErr(err)
	}
	return ut.ID, ut.Flow, int64(ut.Num), ut.ExpTime, ut.FlowResetTime, ut.SpeedID, ut.Status, nil
}

func (r *Repository) InsertUserTunnel(userID, tunnelID int64, speedID interface{}, num int, flow, flowResetTime, expTime int64, status int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	ut := model.UserTunnel{
		UserID:        userID,
		TunnelID:      tunnelID,
		SpeedID:       nullInt64FromInterface(speedID),
		Num:           num,
		Flow:          flow,
		InFlow:        0,
		OutFlow:       0,
		FlowResetTime: flowResetTime,
		ExpTime:       expTime,
		Status:        status,
	}
	return r.db.Create(&ut).Error
}

func (r *Repository) UpdateUserTunnelFields(id int64, speedID interface{}, flow int64, num int, expTime, flowResetTime int64, status int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.UserTunnel{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"speed_id":        nullInt64FromInterface(speedID),
			"flow":            flow,
			"num":             num,
			"exp_time":        expTime,
			"flow_reset_time": flowResetTime,
			"status":          status,
		}).Error
}

func (r *Repository) GetMinForwardPort(forwardID int64) sql.NullInt64 {
	if r == nil || r.db == nil {
		return sql.NullInt64{}
	}
	var p sql.NullInt64
	_ = r.db.Model(&model.ForwardPort{}).
		Select("MIN(port)").
		Where("forward_id = ?", forwardID).
		Scan(&p).Error
	return p
}

func (r *Repository) UpdateForward(id int64, name string, tunnelID int64, remoteAddr, strategy string, now int64, speedID interface{}, maxConnections int, trafficLimit int64, expiryTime interface{}, speedLimitEnabled bool, speedLimit int, mode string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Forward{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"name":                name,
			"tunnel_id":           tunnelID,
			"remote_addr":         remoteAddr,
			"strategy":            strategy,
			"speed_id":            nullInt64FromInterface(speedID),
			"max_connections":     maxConnections,
			"traffic_limit":       trafficLimit,
			"expiry_time":         nullInt64FromInterface(expiryTime),
			"speed_limit_enabled": speedLimitEnabled,
			"speed_limit":         speedLimit,
			"mode":                mode,
			"updated_time":        now,
		}).Error
}

func (r *Repository) UpdateForwardOrder(forwardID int64, inx int, now int64) {
	if r == nil || r.db == nil {
		return
	}
	_ = r.db.Model(&model.Forward{}).
		Where("id = ?", forwardID).
		Updates(map[string]interface{}{"inx": inx, "updated_time": now}).Error
}

func (r *Repository) UpdateForwardTunnel(forwardID, tunnelID int64, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Forward{}).
		Where("id = ?", forwardID).
		Updates(map[string]interface{}{"tunnel_id": tunnelID, "updated_time": now}).Error
}

func (r *Repository) DeleteForwardCascade(forwardID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("forward_id = ?", forwardID).Delete(&model.ForwardPort{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", forwardID).Delete(&model.Forward{}).Error
	})
}

func (r *Repository) ReplaceForwardPorts(forwardID int64, entries []struct {
	NodeID int64
	Port   int
	InIP   string
}) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("forward_id = ?", forwardID).Delete(&model.ForwardPort{}).Error; err != nil {
			return err
		}
		if len(entries) == 0 {
			return nil
		}

		rows := make([]model.ForwardPort, 0, len(entries))
		for _, e := range entries {
			rows = append(rows, model.ForwardPort{
				ForwardID: forwardID,
				NodeID:    e.NodeID,
				Port:      e.Port,
				InIP:      sql.NullString{String: e.InIP, Valid: e.InIP != ""},
			})
		}
		return tx.Create(&rows).Error
	})
}

func (r *Repository) CheckAndDecrementStock(packageID int64, quantity int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current model.SubscriptionPackage
		if err := tx.Where("id = ?", packageID).First(&current).Error; err != nil {
			return errors.New("套餐不存在")
		}
		if current.Stock == -1 {
			return nil
		}
		if current.Stock < quantity {
			return errors.New("库存不足")
		}
		return tx.Model(&model.SubscriptionPackage{}).
			Where("id = ?", packageID).
			Update("stock", gorm.Expr("stock - ?", quantity)).Error
	})
}

func (r *Repository) RestorePackageStock(packageID int64, quantity int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.SubscriptionPackage{}).
		Where("id = ?", packageID).
		Update("stock", gorm.Expr("stock + ?", quantity)).Error
}

func (r *Repository) CreatePackage(pkg *model.SubscriptionPackage, tunnelGroupIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	pkg.CreatedAt = now
	pkg.UpdatedAt = now
	tx := r.db.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback()
	if err := tx.Create(pkg).Error; err != nil {
		return err
	}
	for _, tgID := range tunnelGroupIDs {
		if err := tx.Create(&model.SubscriptionPackageTunnelGroup{PackageID: pkg.ID, TunnelGroupID: tgID}).Error; err != nil {
			return err
		}
	}
	return tx.Commit().Error
}

func (r *Repository) UpdatePackage(pkg *model.SubscriptionPackage, tunnelGroupIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	pkg.UpdatedAt = time.Now().UnixMilli()
	var groupIDVal interface{} = nil
	if pkg.GroupID.Valid {
		groupIDVal = pkg.GroupID.Int64
	}
	tx := r.db.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback()
	if err := tx.Model(pkg).Updates(map[string]interface{}{
		"type": pkg.Type, "name": pkg.Name, "description": pkg.Description,
		"price": pkg.Price, "validity_days": pkg.ValidityDays,
		"traffic_limit": pkg.TrafficLimit, "port_count": pkg.PortCount,
		"speed_limit": pkg.SpeedLimit, "max_rules": pkg.MaxRules,
		"max_connections": pkg.MaxConnections, "max_ip_access": pkg.MaxIPAccess,
		"auto_renew": pkg.AutoRenew, "sort_order": pkg.SortOrder,
		"enabled": pkg.Enabled, "shop_visible": pkg.ShopVisible,
		"auto_buy_traffic_enabled": pkg.AutoBuyTrafficEnabled,
		"stock":                    pkg.Stock,
		"recommended":              pkg.Recommended,
		"group_id":                 groupIDVal,
		"updated_at":               pkg.UpdatedAt,
	}).Error; err != nil {
		return err
	}
	tx.Where("package_id = ?", pkg.ID).Delete(&model.SubscriptionPackageTunnelGroup{})
	for _, tgID := range tunnelGroupIDs {
		if err := tx.Create(&model.SubscriptionPackageTunnelGroup{PackageID: pkg.ID, TunnelGroupID: tgID}).Error; err != nil {
			return err
		}
	}
	return tx.Commit().Error
}

func (r *Repository) DeletePackage(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	tx := r.db.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback()
	tx.Where("package_id = ?", id).Delete(&model.SubscriptionPackageTunnelGroup{})
	tx.Where("package_id = ?", id).Delete(&model.PackageSubscription{})
	if err := tx.Delete(&model.SubscriptionPackage{}, id).Error; err != nil {
		return err
	}
	return tx.Commit().Error
}

func (r *Repository) ListPackages(onlyActive bool) ([]*model.SubscriptionPackage, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	q := r.db.Order("sort_order ASC, id DESC")
	if onlyActive {
		q = q.Where("enabled = 1 AND shop_visible = 1")
	}
	var items []*model.SubscriptionPackage
	if err := q.Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) GetPackageTunnelGroupIDs(packageID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var rows []*model.SubscriptionPackageTunnelGroup
	if err := r.db.Where("package_id = ?", packageID).Find(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]int64, len(rows))
	for i, row := range rows {
		ids[i] = row.TunnelGroupID
	}
	return ids, nil
}

func (r *Repository) GetPackageByID(id int64) (*model.SubscriptionPackage, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var pkg model.SubscriptionPackage
	if err := r.db.First(&pkg, id).Error; err != nil {
		return nil, err
	}
	return &pkg, nil
}

// GetTunnelsInGroups returns all tunnel IDs that belong to the given tunnel group IDs.
func (r *Repository) GetTunnelsInGroups(groupIDs []int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(groupIDs) == 0 {
		return nil, nil
	}
	var ids []int64
	if err := r.db.Model(&model.TunnelGroupTunnel{}).
		Where("tunnel_group_id IN ?", groupIDs).
		Pluck("tunnel_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// DeliverPackageToUser applies a subscription package to a user: deactivates old subscriptions,
// creates a new PackageSubscription, updates user quotas, and grants tunnel permissions.
func (r *Repository) CompletePackageOrder(userID int64, userName string, order *model.Order, pkg *model.SubscriptionPackage, tunnelGroupIDs []int64, quantity int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	// Resolve tunnel IDs OUTSIDE the transaction to avoid SQLite deadlock
	tunnelIDs, err := r.GetTunnelsInGroups(tunnelGroupIDs)
	if err != nil {
		return err
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 0. Create order inside transaction (prevents orphaned orders on failure)
		order.CreatedAt = time.Now().Unix()
		order.UpdatedAt = order.CreatedAt
		if err := tx.Create(order).Error; err != nil {
			return err
		}
		// 1. Deduct balance atomically (same transaction as delivery)
		result := tx.Model(&model.User{}).
			Where("id = ? AND balance >= ?", userID, order.Amount).
			Update("balance", gorm.Expr("balance - ?", order.Amount))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("余额不足")
		}
		// 2. Create balance log
		var user model.User
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		log := &model.BalanceLog{
			UserID:        userID,
			UserName:      userName,
			Amount:        -order.Amount,
			BalanceBefore: user.Balance + order.Amount,
			BalanceAfter:  user.Balance,
			Reason:        "余额购买套餐:" + pkg.Name,
			CreatedTime:   now,
			Signature:     SignBalanceLog(userID, -order.Amount, user.Balance+order.Amount, user.Balance, now, "余额购买套餐:"+pkg.Name),
		}
		if err := tx.Create(log).Error; err != nil {
			return err
		}
		// 3. Update order status to paid
		if err := tx.Model(&model.Order{}).Where("id = ?", order.ID).Updates(map[string]interface{}{
			"status":   1,
			"pay_time": time.Now().Unix(),
		}).Error; err != nil {
			return err
		}
		// 4. Deliver product by type
		switch pkg.Type {
		case "traffic":
			trafficGB := pkg.TrafficLimit * quantity
			if err := tx.Model(&model.User{}).
				Where("id = ?", userID).
				Updates(map[string]interface{}{
					"flow":               gorm.Expr("flow + ?", trafficGB),
					"traffic_flow":       gorm.Expr("traffic_flow + ?", trafficGB),
					"buy_traffic_price":  pkg.Price,
					"buy_traffic_amount": trafficGB,
					"updated_time":       now,
				}).Error; err != nil {
				return err
			}
		default: // subscription
			// 4a. Deactivate old active subscriptions
			if err := tx.Model(&model.PackageSubscription{}).
				Where("user_id = ? AND status = 1", userID).
				Updates(map[string]interface{}{
					"status":     0,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
			// 4b. Create new subscription
			var expireAt int64
			if pkg.ValidityDays == 0 {
				expireAt = 2727251700000 // 永久：2056-08-28
			} else {
				// 按日历月计算，避免日期漂移（30 天≠1 个月）
				months := 0
				switch pkg.ValidityDays {
				case 7:
					expireAt = time.Now().AddDate(0, 0, 7).UnixMilli()
				case 30:
					months = 1
				case 90:
					months = 3
				case 180:
					months = 6
				case 365:
					months = 12
				case 730:
					months = 24
				default:
					expireAt = time.Now().AddDate(0, 0, pkg.ValidityDays).UnixMilli()
				}
				if months > 0 {
					expireAt = time.Now().AddDate(0, months, 0).UnixMilli()
				}
			}
			sub := &model.PackageSubscription{
				UserID:    userID,
				PackageID: pkg.ID,
				StartAt:   time.Now().UnixMilli(),
				ExpireAt:  expireAt,
				AutoRenew: pkg.AutoRenew,
				Status:    1,
				OrderID:   order.ID,
				CreatedAt: now,
				UpdatedAt: now,
			}
			if err := tx.Create(sub).Error; err != nil {
				return err
			}
			// 4c. Update user quotas (flow = replace directly; other quotas keep larger values)
			var existingUser model.User
			if err := tx.Where("id = ?", userID).First(&existingUser).Error; err != nil {
				return err
			}
			newFlow := int64(pkg.TrafficLimit)
			newExpTime := expireAt
			newNum := pkg.MaxRules
			newSpeedLimit := pkg.SpeedLimit
			if existingUser.SpeedLimit > newSpeedLimit {
				newSpeedLimit = existingUser.SpeedLimit
			}
			newMaxConns := pkg.MaxConnections
			if existingUser.MaxConnections > newMaxConns {
				newMaxConns = existingUser.MaxConnections
			}
			newMaxIP := pkg.MaxIPAccess
			if existingUser.MaxIPAccess > newMaxIP {
				newMaxIP = existingUser.MaxIPAccess
			}
			updates := map[string]interface{}{
				"flow":            newFlow,
				"num":             newNum,
				"exp_time":        newExpTime,
				"flow_reset_time": time.UnixMilli(expireAt).Day(),
				"renewal_amount":  pkg.Price,
				"speed_limit":     newSpeedLimit,
				"max_connections": newMaxConns,
				"max_ip_access":   newMaxIP,
				"updated_time":    now,
			}
			if err := tx.Model(&model.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
				return err
			}
			// 4d. Grant tunnel permissions
			for _, tunnelID := range tunnelIDs {
				var existing model.UserTunnel
				err := tx.Select("id").Where("user_id = ? AND tunnel_id = ?", userID, tunnelID).First(&existing).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					ut := model.UserTunnel{
						UserID:   userID,
						TunnelID: tunnelID,
						Num:      pkg.PortCount,
						Flow:     int64(pkg.TrafficLimit),
						ExpTime:  expireAt,
						Status:   1,
					}
					if err := tx.Create(&ut).Error; err != nil {
						return err
					}
				} else if err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// DeliverPackageToUser applies a subscription package to a user: deactivates old subscriptions,
// creates a new PackageSubscription, updates user quotas, and grants tunnel permissions.
// Used for non-balance purchases (external payment callbacks, admin assignment).
func (r *Repository) DeliverPackageToUser(userID int64, pkg *model.SubscriptionPackage, orderID int64, tunnelGroupIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	// Resolve tunnel IDs OUTSIDE the transaction to avoid SQLite deadlock
	tunnelIDs, err := r.GetTunnelsInGroups(tunnelGroupIDs)
	if err != nil {
		return err
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 1. Deactivate old active subscriptions for this user
		if err := tx.Model(&model.PackageSubscription{}).
			Where("user_id = ? AND status = 1", userID).
			Updates(map[string]interface{}{
				"status":     0,
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		// 2. Create new subscription
		var expireAt int64
		if pkg.ValidityDays == 0 {
			expireAt = 2727251700000 // 永久：2056-08-28
		} else {
			// 按日历月计算，避免日期漂移（30 天≠1 个月）
			months := 0
			switch pkg.ValidityDays {
			case 7:
				expireAt = time.Now().AddDate(0, 0, 7).UnixMilli()
			case 30:
				months = 1
			case 90:
				months = 3
			case 180:
				months = 6
			case 365:
				months = 12
			case 730:
				months = 24
			default:
				expireAt = time.Now().AddDate(0, 0, pkg.ValidityDays).UnixMilli()
			}
			if months > 0 {
				expireAt = time.Now().AddDate(0, months, 0).UnixMilli()
			}
		}
		sub := &model.PackageSubscription{
			UserID:    userID,
			PackageID: pkg.ID,
			StartAt:   time.Now().UnixMilli(),
			ExpireAt:  expireAt,
			AutoRenew: pkg.AutoRenew,
			Status:    1,
			OrderID:   orderID,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := tx.Create(sub).Error; err != nil {
			return err
		}
		// 3. Update user quotas (num/expTime replace directly; other quotas keep larger values)
		var existingUser model.User
		if err := tx.Where("id = ?", userID).First(&existingUser).Error; err != nil {
			return err
		}
		newFlow := int64(pkg.TrafficLimit)
		isAdmin := existingUser.RoleID == 0
		newExpTime := expireAt
		newNum := pkg.MaxRules
		newSpeedLimit := pkg.SpeedLimit
		if existingUser.SpeedLimit > newSpeedLimit {
			newSpeedLimit = existingUser.SpeedLimit
		}
		newMaxConns := pkg.MaxConnections
		if existingUser.MaxConnections > newMaxConns {
			newMaxConns = existingUser.MaxConnections
		}
		newMaxIP := pkg.MaxIPAccess
		if existingUser.MaxIPAccess > newMaxIP {
			newMaxIP = existingUser.MaxIPAccess
		}
		updates := map[string]interface{}{
			"exp_time":        newExpTime,
			"flow_reset_time": time.UnixMilli(expireAt).Day(),
			"renewal_amount":  pkg.Price,
			"updated_time":    now,
		}
		if !isAdmin {
			updates["flow"] = newFlow
			updates["num"] = newNum
			updates["speed_limit"] = newSpeedLimit
			updates["max_connections"] = newMaxConns
			updates["max_ip_access"] = newMaxIP
		}
		if err := tx.Model(&model.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
			return err
		}
		// 4. Grant tunnel permissions for each tunnel in the package's tunnel groups
		for _, tunnelID := range tunnelIDs {
			var existing model.UserTunnel
			err := tx.Select("id").Where("user_id = ? AND tunnel_id = ?", userID, tunnelID).First(&existing).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				ut := model.UserTunnel{
					UserID:   userID,
					TunnelID: tunnelID,
					Num:      pkg.PortCount,
					Flow:     int64(pkg.TrafficLimit),
					ExpTime:  expireAt,
					Status:   1,
				}
				if err := tx.Create(&ut).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}
		return nil
	})
}

// DeliverBalancePackageToUser applies a balance package: adds balance to user.
func (r *Repository) DeliverBalancePackageToUser(userID int64, amountCents int64, pkgName string, orderID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	totalAmount := amountCents
	user, err := r.GetUserByID(userID)
	if err != nil {
		return err
	}
	if err := r.IncreaseUserBalance(userID, totalAmount); err != nil {
		return err
	}
	if err := r.CreateBalanceLog(userID, user.User, totalAmount,
		user.Balance, user.Balance+totalAmount,
		now, "余额充值:"+pkgName); err != nil {
		return err
	}
	r.TryAutoRenewForUser(userID)
	return nil
}

// DeliverTrafficPackageToUser applies a traffic package: adds flow to user.
func (r *Repository) DeliverTrafficPackageToUser(userID int64, trafficGB int64, price int64, trafficLimit int64, quantity int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	totalGB := trafficGB * quantity
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"flow":               gorm.Expr("flow + ?", totalGB),
			"traffic_flow":       gorm.Expr("traffic_flow + ?", totalGB),
			"buy_traffic_price":  price,
			"buy_traffic_amount": totalGB,
			"updated_time":       time.Now().UnixMilli(),
		}).Error
}

// GetPackageSubscriptionByOrderID returns the PackageSubscription linked to an order.
func (r *Repository) GetPackageSubscriptionByOrderID(orderID int64) (*model.PackageSubscription, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var sub model.PackageSubscription
	if err := r.db.Where("order_id = ?", orderID).First(&sub).Error; err != nil {
		return nil, err
	}
	return &sub, nil
}

// RefundTrafficPackage subtracts traffic from a user's flow (allows negative).
func (r *Repository) RefundTrafficPackage(userID int64, trafficGB int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"flow":         gorm.Expr("flow - ?", trafficGB),
			"traffic_flow": gorm.Expr("traffic_flow - ?", trafficGB),
		}).Error
}

// ListExpiredPackageSubscriptions returns active subscriptions that have expired.
func (r *Repository) ListExpiredPackageSubscriptions() ([]*model.PackageSubscription, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	var list []*model.PackageSubscription
	if err := r.db.Where("status = 1 AND expire_at < ?", now).Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// ExpirePackageSubscription marks a subscription as expired.
func (r *Repository) ExpirePackageSubscription(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.PackageSubscription{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":     0,
			"updated_at": time.Now().UnixMilli(),
		}).Error
}

// ResetUserPackageQuotas resets package-related quota fields on the user to 0.
func (r *Repository) ResetUserPackageQuotas(userID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"num":             0,
			"speed_limit":     0,
			"max_connections": 0,
			"max_ip_access":   0,
			"updated_time":    time.Now().UnixMilli(),
		}).Error
}

// GetUserActiveSubscription returns the user's active subscription with package details.
// Returns nil if no active subscription exists.
func (r *Repository) GetUserActiveSubscription(userID int64) (*model.PackageSubscription, *model.SubscriptionPackage, error) {
	if r == nil || r.db == nil {
		return nil, nil, errors.New("repository not initialized")
	}
	var sub model.PackageSubscription
	if err := r.db.Where("user_id = ? AND status = 1", userID).First(&sub).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	var pkg model.SubscriptionPackage
	if err := r.db.First(&pkg, sub.PackageID).Error; err != nil {
		return &sub, nil, nil
	}
	return &sub, &pkg, nil
}

func (r *Repository) CountNodes() (int64, error) {
	var count int64
	err := r.db.Model(&model.Node{}).Count(&count).Error
	return count, err
}

func (r *Repository) CountTunnels() (int64, error) {
	var count int64
	err := r.db.Model(&model.Tunnel{}).Count(&count).Error
	return count, err
}

func (r *Repository) CountUsers() (int64, error) {
	var count int64
	err := r.db.Model(&model.User{}).Where("role_id != ?", 0).Count(&count).Error
	return count, err
}

func (r *Repository) RenewUserWithBalance(userID, renewalAmount, newExpTime, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	user, err := r.GetUserByID(userID)
	if err != nil {
		return err
	}

	if user.Balance < renewalAmount {
		return errors.New("insufficient balance")
	}

	tx := r.db.Begin()
	defer func() { tx.Rollback() }()

	err = tx.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"balance":      user.Balance - renewalAmount,
			"exp_time":     newExpTime,
			"updated_time": sql.NullInt64{Int64: now, Valid: true},
		}).Error
	if err != nil {
		return err
	}

	log := &model.UserRenewalLog{
		UserID:        userID,
		UserName:      user.User,
		RenewalAmount: renewalAmount,
		BalanceBefore: user.Balance,
		BalanceAfter:  user.Balance - renewalAmount,
		ExpTimeBefore: user.ExpTime,
		ExpTimeAfter:  newExpTime,
		RenewalTime:   now,
		OperatorID:    sql.NullInt64{Int64: 0, Valid: true},
		OperatorName:  sql.NullString{String: "系统", Valid: true},
		Reason:        "自动续费",
	}
	err = tx.Create(log).Error
	if err != nil {
		return err
	}

	balanceLog := &model.BalanceLog{
		UserID:        userID,
		UserName:      user.User,
		Amount:        -renewalAmount,
		BalanceBefore: user.Balance,
		BalanceAfter:  user.Balance - renewalAmount,
		Reason:        "自动续费",
		CreatedTime:   now,
		Signature:     SignBalanceLog(userID, -renewalAmount, user.Balance, user.Balance-renewalAmount, now, "自动续费"),
	}
	err = tx.Create(balanceLog).Error
	if err != nil {
		return err
	}

	return tx.Commit().Error
}

type UserTrafficBuyLogItem struct {
	ID            int64  `json:"id"`
	UserID        int64  `json:"userId"`
	UserName      string `json:"userName"`
	BuyAmount     int64  `json:"buyAmount"`
	BuyPrice      int64  `json:"buyPrice"`
	BalanceBefore int64  `json:"balanceBefore"`
	BalanceAfter  int64  `json:"balanceAfter"`
	FlowBefore    int64  `json:"flowBefore"`
	FlowAfter     int64  `json:"flowAfter"`
	BuyTime       int64  `json:"buyTime"`
	Reason        string `json:"reason"`
}

func (r *Repository) GetUserTrafficBuyLogs(userID int64, limit int) ([]UserTrafficBuyLogItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var logs []model.UserTrafficBuyLog
	err := r.db.
		Where("user_id = ?", userID).
		Order("buy_time DESC").
		Limit(limit).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}

	items := make([]UserTrafficBuyLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, UserTrafficBuyLogItem{
			ID:            log.ID,
			UserID:        log.UserID,
			UserName:      log.UserName,
			BuyAmount:     log.BuyAmount,
			BuyPrice:      log.BuyPrice,
			BalanceBefore: log.BalanceBefore,
			BalanceAfter:  log.BalanceAfter,
			FlowBefore:    log.FlowBefore,
			FlowAfter:     log.FlowAfter,
			BuyTime:       log.BuyTime,
			Reason:        log.Reason,
		})
	}
	return items, nil
}

func (r *Repository) DeleteUserTrafficBuyLog(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.UserTrafficBuyLog{}, id).Error
}

func (r *Repository) MarkUserAutoRenewSuccess(userID, newExpTime, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}

		var quota model.UserQuota
		_ = tx.Where("user_id = ?", userID).First(&quota).Error

		inFlowBefore := user.InFlow
		outFlowBefore := user.OutFlow
		totalBytes := inFlowBefore + outFlowBefore

		if err := tx.Model(&model.User{}).
			Where("id = ?", userID).
			Updates(map[string]interface{}{
				"status":       1,
				"in_flow":      0,
				"out_flow":     0,
				"updated_time": sql.NullInt64{Int64: now, Valid: true},
			}).Error; err != nil {
			return err
		}

		if err := tx.Model(&model.UserQuota{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"monthly_used_bytes": 0,
				"updated_time":       now,
				"disabled_by_quota":  0,
				"disabled_at":        0,
				"paused_forward_ids": "",
			}).Error; err != nil {
			return err
		}

		if inFlowBefore > 0 || outFlowBefore > 0 {
			history := &model.UserQuotaHistory{
				UserID:        userID,
				PeriodType:    "monthly",
				PeriodKey:     quota.MonthKey,
				InFlowBefore:  inFlowBefore,
				OutFlowBefore: outFlowBefore,
				UsedBytes:     totalBytes,
				ResetTime:     now,
				CreatedTime:   now,
				ResetReason:   "自动续费",
			}
			if err := tx.Create(history).Error; err != nil {
				return err
			}
		}

		return tx.Model(&model.UserTunnel{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"exp_time": newExpTime,
				"in_flow":  0,
				"out_flow": 0,
				"status":   1,
			}).Error
	})
}

func (r *Repository) MarkExpiredUserAutoRenewFailure(userID, now int64, resetReason string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}

		inFlowBefore := user.InFlow
		outFlowBefore := user.OutFlow
		totalBytes := inFlowBefore + outFlowBefore

		if err := tx.Model(&model.User{}).
			Where("id = ?", userID).
			Updates(map[string]interface{}{
				"status":       0,
				"in_flow":      0,
				"out_flow":     0,
				"updated_time": sql.NullInt64{Int64: now, Valid: true},
			}).Error; err != nil {
			return err
		}

		history := &model.UserQuotaHistory{
			UserID:        userID,
			PeriodType:    "monthly",
			PeriodKey:     int64(time.UnixMilli(now).Year()*100 + int(time.UnixMilli(now).Month())),
			InFlowBefore:  inFlowBefore,
			OutFlowBefore: outFlowBefore,
			UsedBytes:     totalBytes,
			ResetTime:     now,
			CreatedTime:   now,
			ResetReason:   resetReason,
		}
		if err := tx.Create(history).Error; err != nil {
			return err
		}

		return tx.Model(&model.UserTunnel{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"in_flow":  0,
				"out_flow": 0,
				"status":   0,
			}).Error
	})
}

type UserRenewalLogItem struct {
	ID            int64  `json:"id"`
	UserID        int64  `json:"userId"`
	UserName      string `json:"userName"`
	RenewalAmount int64  `json:"renewalAmount"`
	BalanceBefore int64  `json:"balanceBefore"`
	BalanceAfter  int64  `json:"balanceAfter"`
	ExpTimeBefore int64  `json:"expTimeBefore"`
	ExpTimeAfter  int64  `json:"expTimeAfter"`
	RenewalTime   int64  `json:"renewalTime"`
	OperatorName  string `json:"operatorName"`
	Reason        string `json:"reason"`
}

func (r *Repository) DeleteUserRenewalLog(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.UserRenewalLog{}, id).Error
}

func (r *Repository) CreateUserRenewalLog(userID int64, renewalAmount, balanceBefore, balanceAfter, expTimeBefore, expTimeAfter, now int64, operatorName, reason string) {
	if r == nil || r.db == nil {
		return
	}
	user, err := r.GetUserByID(userID)
	if err != nil {
		return
	}
	log := &model.UserRenewalLog{
		UserID:        userID,
		UserName:      user.User,
		RenewalAmount: renewalAmount,
		BalanceBefore: balanceBefore,
		BalanceAfter:  balanceAfter,
		ExpTimeBefore: expTimeBefore,
		ExpTimeAfter:  expTimeAfter,
		RenewalTime:   now,
		OperatorID:    sql.NullInt64{Int64: 1, Valid: true},
		OperatorName:  sql.NullString{String: operatorName, Valid: true},
		Reason:        reason,
	}
	_ = r.db.Create(log).Error
}

func (r *Repository) GetUserRenewalLogs(userID int64, limit int) ([]UserRenewalLogItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var logs []model.UserRenewalLog
	err := r.db.
		Where("user_id = ?", userID).
		Order("renewal_time DESC").
		Limit(limit).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}

	items := make([]UserRenewalLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, UserRenewalLogItem{
			ID:            log.ID,
			UserID:        log.UserID,
			UserName:      log.UserName,
			RenewalAmount: log.RenewalAmount,
			BalanceBefore: log.BalanceBefore,
			BalanceAfter:  log.BalanceAfter,
			ExpTimeBefore: log.ExpTimeBefore,
			ExpTimeAfter:  log.ExpTimeAfter,
			RenewalTime:   log.RenewalTime,
			OperatorName:  log.OperatorName.String,
			Reason:        log.Reason,
		})
	}
	return items, nil
}

func (r *Repository) UpdateForwardPortBindIP(forwardID, nodeID int64, port int, inIP string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if forwardID <= 0 || nodeID <= 0 || port <= 0 {
		return nil
	}
	return r.db.Model(&model.ForwardPort{}).
		Where("forward_id = ? AND node_id = ? AND port = ?", forwardID, nodeID, port).
		Update("in_ip", sql.NullString{String: inIP, Valid: strings.TrimSpace(inIP) != ""}).Error
}

func (r *Repository) RollbackForwardFields(id, userID int64, userName, name string, tunnelID int64, remoteAddr, strategy string, status int, speedID interface{}, now int64) {
	if r == nil || r.db == nil {
		return
	}
	_ = r.db.Model(&model.Forward{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"user_id":      userID,
			"user_name":    userName,
			"name":         name,
			"tunnel_id":    tunnelID,
			"remote_addr":  remoteAddr,
			"strategy":     strategy,
			"status":       status,
			"speed_id":     nullInt64FromInterface(speedID),
			"updated_time": now,
		}).Error
}

func (r *Repository) GetUsedPortsOnNodeAsMap(nodeID int64) (map[int]bool, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	used := make(map[int]bool)
	var forwardPorts []int
	if err := r.db.Model(&model.ForwardPort{}).Where("node_id = ?", nodeID).Pluck("port", &forwardPorts).Error; err != nil {
		return nil, err
	}
	for _, p := range forwardPorts {
		used[p] = true
	}
	var chainPorts []int
	if err := r.db.Model(&model.ChainTunnel{}).Where("node_id = ? AND port > 0", nodeID).Pluck("port", &chainPorts).Error; err != nil {
		return nil, err
	}
	for _, p := range chainPorts {
		used[p] = true
	}
	return used, nil
}

func (r *Repository) CreateSpeedLimit(name string, speed int, now int64, status int) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	sl := model.SpeedLimit{
		Name:        name,
		Speed:       speed,
		TunnelID:    sql.NullInt64{Int64: 0, Valid: false},
		TunnelName:  sql.NullString{String: "", Valid: false},
		CreatedTime: now,
		UpdatedTime: sql.NullInt64{Int64: now, Valid: true},
		Status:      status,
	}
	if err := r.db.Create(&sl).Error; err != nil {
		return 0, err
	}
	return sl.ID, nil
}

func (r *Repository) UpdateSpeedLimit(id int64, name string, speed int, status int, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	updates := map[string]interface{}{
		"name":        name,
		"speed":       speed,
		"status":      status,
		"tunnel_id":   nil,
		"tunnel_name": nil,
		"updated_time": sql.NullInt64{
			Int64: now,
			Valid: true,
		},
	}
	return r.db.Model(&model.SpeedLimit{}).
		Where("id = ?", id).
		Updates(updates).Error
}

func (r *Repository) DeleteSpeedLimit(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("id = ?", id).Delete(&model.SpeedLimit{}).Error
}

func (r *Repository) GroupCreate(table, name string, status int, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	switch table {
	case "tunnel_group":
		return r.db.Create(&model.TunnelGroup{
			Name:        name,
			CreatedTime: now,
			UpdatedTime: now,
			Status:      status,
		}).Error
	case "user_group":
		return r.db.Create(&model.UserGroup{
			Name:        name,
			CreatedTime: now,
			UpdatedTime: now,
			Status:      status,
		}).Error
	default:
		return errors.New("invalid group table")
	}
}

func (r *Repository) GroupUpdate(table string, id int64, name string, status int, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	updates := map[string]interface{}{"name": name, "status": status, "updated_time": now}
	switch table {
	case "tunnel_group":
		return r.db.Model(&model.TunnelGroup{}).Where("id = ?", id).Updates(updates).Error
	case "user_group":
		return r.db.Model(&model.UserGroup{}).Where("id = ?", id).Updates(updates).Error
	default:
		return errors.New("invalid group table")
	}
}

func (r *Repository) GroupDeleteCascade(table string, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		switch table {
		case "tunnel_group":
			if err := tx.Where("tunnel_group_id = ?", id).Delete(&model.TunnelGroupTunnel{}).Error; err != nil {
				return err
			}
			if err := tx.Where("tunnel_group_id = ?", id).Delete(&model.GroupPermission{}).Error; err != nil {
				return err
			}
			if err := tx.Where("tunnel_group_id = ?", id).Delete(&model.GroupPermissionGrant{}).Error; err != nil {
				return err
			}
			return tx.Where("id = ?", id).Delete(&model.TunnelGroup{}).Error
		case "user_group":
			if err := tx.Where("user_group_id = ?", id).Delete(&model.UserGroupUser{}).Error; err != nil {
				return err
			}
			if err := tx.Where("user_group_id = ?", id).Delete(&model.GroupPermission{}).Error; err != nil {
				return err
			}
			if err := tx.Where("user_group_id = ?", id).Delete(&model.GroupPermissionGrant{}).Error; err != nil {
				return err
			}
			return tx.Where("id = ?", id).Delete(&model.UserGroup{}).Error
		default:
			return errors.New("invalid group table")
		}
	})
}

func (r *Repository) ListUserIDsByUserGroupTx(tx *gorm.DB, userGroupID int64) ([]int64, error) {
	if tx == nil {
		return nil, errors.New("database unavailable")
	}
	var ids []int64
	err := tx.Model(&model.UserGroupUser{}).
		Where("user_group_id = ?", userGroupID).
		Pluck("user_id", &ids).Error
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = make([]int64, 0)
	}
	return ids, nil
}

func (r *Repository) ReplaceTunnelGroupMembersTx(tx *gorm.DB, groupID int64, tunnelIDs []int64, now int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	if err := tx.Where("tunnel_group_id = ?", groupID).Delete(&model.TunnelGroupTunnel{}).Error; err != nil {
		return err
	}
	if len(tunnelIDs) == 0 {
		return nil
	}
	rows := make([]model.TunnelGroupTunnel, 0, len(tunnelIDs))
	for _, tunnelID := range tunnelIDs {
		if tunnelID <= 0 {
			continue
		}
		rows = append(rows, model.TunnelGroupTunnel{TunnelGroupID: groupID, TunnelID: tunnelID, CreatedTime: now})
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

func (r *Repository) ReplaceUserGroupMembersTx(tx *gorm.DB, groupID int64, userIDs []int64, now int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	if err := tx.Where("user_group_id = ?", groupID).Delete(&model.UserGroupUser{}).Error; err != nil {
		return err
	}
	if len(userIDs) == 0 {
		return nil
	}
	rows := make([]model.UserGroupUser, 0, len(userIDs))
	for _, userID := range userIDs {
		if userID <= 0 {
			continue
		}
		rows = append(rows, model.UserGroupUser{UserGroupID: groupID, UserID: userID, CreatedTime: now})
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

func (r *Repository) GetGroupPermissionPairByIDTx(tx *gorm.DB, id int64) (userGroupID int64, tunnelGroupID int64, exists bool, err error) {
	if tx == nil {
		return 0, 0, false, errors.New("database unavailable")
	}
	var gp model.GroupPermission
	err = tx.Select("user_group_id", "tunnel_group_id").Where("id = ?", id).First(&gp).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	return gp.UserGroupID, gp.TunnelGroupID, true, nil
}

func (r *Repository) DeleteGroupPermissionByIDTx(tx *gorm.DB, id int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	return tx.Where("id = ?", id).Delete(&model.GroupPermission{}).Error
}

// RevokedUserTunnelPair holds the (userID, tunnelID) of a deleted user_tunnel row,
// so the handler layer can clean up associated forwarding rules.
type RevokedUserTunnelPair struct {
	UserID   int64
	TunnelID int64
}

func (r *Repository) RevokeGroupGrantsForRemovedUsersTx(tx *gorm.DB, userGroupID int64, previousUserIDs, currentUserIDs []int64) ([]RevokedUserTunnelPair, error) {
	if tx == nil {
		return nil, errors.New("database unavailable")
	}
	currentSet := make(map[int64]struct{}, len(currentUserIDs))
	for _, uid := range currentUserIDs {
		if uid > 0 {
			currentSet[uid] = struct{}{}
		}
	}

	removedUserIDs := make([]int64, 0)
	for _, uid := range previousUserIDs {
		if uid <= 0 {
			continue
		}
		if _, ok := currentSet[uid]; !ok {
			removedUserIDs = append(removedUserIDs, uid)
		}
	}
	if len(removedUserIDs) == 0 {
		return nil, nil
	}

	type grantRow struct {
		UserTunnelID   int64
		CreatedByGroup int
	}

	var revoked []RevokedUserTunnelPair

	for _, userID := range removedUserIDs {
		var rows []grantRow
		if err := tx.Model(&model.GroupPermissionGrant{}).
			Select("group_permission_grant.user_tunnel_id, group_permission_grant.created_by_group").
			Joins("JOIN user_tunnel ON user_tunnel.id = group_permission_grant.user_tunnel_id").
			Where("group_permission_grant.user_group_id = ? AND user_tunnel.user_id = ?", userGroupID, userID).
			Find(&rows).Error; err != nil {
			return revoked, err
		}

		groupCreatedTunnelIDs := make(map[int64]struct{})
		for _, row := range rows {
			if row.CreatedByGroup == 1 && row.UserTunnelID > 0 {
				groupCreatedTunnelIDs[row.UserTunnelID] = struct{}{}
			}
		}

		userTunnelIDs := tx.Model(&model.UserTunnel{}).Select("id").Where("user_id = ?", userID)
		if err := tx.Where("user_group_id = ? AND user_tunnel_id IN (?)", userGroupID, userTunnelIDs).
			Delete(&model.GroupPermissionGrant{}).Error; err != nil {
			return revoked, err
		}

		for userTunnelID := range groupCreatedTunnelIDs {
			var remaining int64
			if err := tx.Model(&model.GroupPermissionGrant{}).Where("user_tunnel_id = ?", userTunnelID).Count(&remaining).Error; err != nil {
				return revoked, err
			}
			if remaining == 0 {
				var ut model.UserTunnel
				if lookupErr := tx.Select("user_id", "tunnel_id").Where("id = ?", userTunnelID).First(&ut).Error; lookupErr == nil {
					revoked = append(revoked, RevokedUserTunnelPair{UserID: ut.UserID, TunnelID: ut.TunnelID})
				}
				if err := tx.Where("id = ?", userTunnelID).Delete(&model.UserTunnel{}).Error; err != nil {
					return revoked, err
				}
			}
		}
	}

	return revoked, nil
}

func (r *Repository) RevokeGroupPermissionPairTx(tx *gorm.DB, userGroupID, tunnelGroupID int64) ([]RevokedUserTunnelPair, error) {
	if tx == nil {
		return nil, errors.New("database unavailable")
	}

	type grantRow struct {
		UserTunnelID   int64
		CreatedByGroup int
	}

	var rows []grantRow
	if err := tx.Model(&model.GroupPermissionGrant{}).
		Select("user_tunnel_id, created_by_group").
		Where("user_group_id = ? AND tunnel_group_id = ?", userGroupID, tunnelGroupID).
		Find(&rows).Error; err != nil {
		return nil, err
	}

	groupCreatedTunnelIDs := make(map[int64]struct{})
	for _, row := range rows {
		if row.CreatedByGroup == 1 && row.UserTunnelID > 0 {
			groupCreatedTunnelIDs[row.UserTunnelID] = struct{}{}
		}
	}

	if err := tx.Where("user_group_id = ? AND tunnel_group_id = ?", userGroupID, tunnelGroupID).
		Delete(&model.GroupPermissionGrant{}).Error; err != nil {
		return nil, err
	}

	var revoked []RevokedUserTunnelPair

	for userTunnelID := range groupCreatedTunnelIDs {
		var remaining int64
		if err := tx.Model(&model.GroupPermissionGrant{}).Where("user_tunnel_id = ?", userTunnelID).Count(&remaining).Error; err != nil {
			return revoked, err
		}
		if remaining == 0 {
			var ut model.UserTunnel
			if lookupErr := tx.Select("user_id", "tunnel_id").Where("id = ?", userTunnelID).First(&ut).Error; lookupErr == nil {
				revoked = append(revoked, RevokedUserTunnelPair{UserID: ut.UserID, TunnelID: ut.TunnelID})
			}
			if err := tx.Where("id = ?", userTunnelID).Delete(&model.UserTunnel{}).Error; err != nil {
				return revoked, err
			}
		}
	}

	return revoked, nil
}

func (r *Repository) ReplaceFederationTunnelBindingsTx(tx *gorm.DB, tunnelID int64, bindings []FederationTunnelBinding) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	if err := tx.Where("tunnel_id = ?", tunnelID).Delete(&model.FederationTunnelBinding{}).Error; err != nil {
		return err
	}
	if len(bindings) == 0 {
		return nil
	}

	rows := make([]model.FederationTunnelBinding, 0, len(bindings))
	now := time.Now().UnixMilli()
	for _, b := range bindings {
		created := b.CreatedTime
		if created <= 0 {
			created = now
		}
		updated := b.UpdatedTime
		if updated <= 0 {
			updated = created
		}
		rows = append(rows, model.FederationTunnelBinding{
			TunnelID:        tunnelID,
			NodeID:          b.NodeID,
			ChainType:       b.ChainType,
			HopInx:          b.HopInx,
			RemoteURL:       b.RemoteURL,
			ResourceKey:     b.ResourceKey,
			RemoteBindingID: b.RemoteBindingID,
			AllocatedPort:   b.AllocatedPort,
			Status:          b.Status,
			CreatedTime:     created,
			UpdatedTime:     updated,
		})
	}

	return tx.Create(&rows).Error
}

func (r *Repository) InsertGroupPermission(userGroupID, tunnelGroupID int64, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	gp := model.GroupPermission{UserGroupID: userGroupID, TunnelGroupID: tunnelGroupID, CreatedTime: now}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&gp).Error
}

func (r *Repository) InsertGroupPermissionGrant(userGroupID, tunnelGroupID, userTunnelID int64, createdByGroup int, now int64) {
	if r == nil || r.db == nil {
		return
	}
	g := model.GroupPermissionGrant{
		UserGroupID:    userGroupID,
		TunnelGroupID:  tunnelGroupID,
		UserTunnelID:   userTunnelID,
		CreatedByGroup: createdByGroup,
		CreatedTime:    now,
	}
	_ = r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&g).Error
}

func (r *Repository) EnsureUserTunnelGrant(userID, tunnelID int64) (int64, bool, error) {
	if r == nil || r.db == nil {
		return 0, false, errors.New("repository not initialized")
	}
	var existing model.UserTunnel
	err := r.db.Select("id").Where("user_id = ? AND tunnel_id = ?", userID, tunnelID).First(&existing).Error
	if err == nil {
		return existing.ID, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, err
	}
	var user model.User
	if err := r.db.Select("flow, num, exp_time, flow_reset_time").Where("id = ?", userID).First(&user).Error; err != nil {
		return 0, false, err
	}
	flow := user.Flow
	num := user.Num
	expTime := user.ExpTime
	flowReset := user.FlowResetTime
	ut := model.UserTunnel{
		UserID:        userID,
		TunnelID:      tunnelID,
		Num:           num,
		Flow:          flow,
		InFlow:        0,
		OutFlow:       0,
		FlowResetTime: flowReset,
		ExpTime:       expTime,
		Status:        1,
	}
	if err := r.db.Create(&ut).Error; err != nil {
		return 0, false, err
	}
	return ut.ID, true, nil
}

func (r *Repository) CreateForwardTx(userID int64, userName, name string, tunnelID int64, remoteAddr, strategy string, now int64, inx int, entryNodeIDs []int64, port int, inIp string, speedID interface{}, maxConnections int, trafficLimit int64, expiryTime interface{}, speedLimitEnabled bool, speedLimit int, mode string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	var forwardID int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		fwd := model.Forward{
			UserID:            userID,
			UserName:          userName,
			Name:              name,
			TunnelID:          tunnelID,
			RemoteAddr:        remoteAddr,
			Strategy:          strategy,
			Mode:              mode,
			InFlow:            0,
			OutFlow:           0,
			CreatedTime:       now,
			UpdatedTime:       now,
			Status:            1,
			Inx:               inx,
			SpeedID:           nullInt64FromInterface(speedID),
			MaxConnections:    maxConnections,
			TrafficLimit:      trafficLimit,
			ExpiryTime:        nullInt64FromInterface(expiryTime),
			SpeedLimitEnabled: speedLimitEnabled,
			SpeedLimit:        speedLimit,
		}
		if err := tx.Create(&fwd).Error; err != nil {
			return err
		}
		forwardID = fwd.ID
		for _, nodeID := range entryNodeIDs {
			fp := model.ForwardPort{
				ForwardID: forwardID,
				NodeID:    nodeID,
				Port:      port,
				InIP:      sql.NullString{String: inIp, Valid: inIp != ""},
			}
			if err := tx.Create(&fp).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return forwardID, err
}

func (r *Repository) BatchUpdateForwardStatus(ids []int64, status int) (int, int) {
	if r == nil || r.db == nil {
		return 0, len(ids)
	}
	s := 0
	f := 0
	now := time.Now().UnixMilli()
	for _, id := range ids {
		if err := r.db.Model(&model.Forward{}).Where("id = ?", id).Updates(map[string]interface{}{"status": status, "updated_time": now}).Error; err != nil {
			f++
		} else {
			s++
		}
	}
	return s, f
}

func (r *Repository) BatchUpdateForwardMode(ids []int64, mode string) error {
	if r == nil || r.db == nil {
		return errors.New("数据库未初始化")
	}
	now := time.Now().UnixMilli()
	return r.db.Model(&model.Forward{}).Where("id IN ?", ids).UpdateColumns(map[string]interface{}{"mode": mode, "updated_time": now}).Error
}

func (r *Repository) CreateTunnelTx(tx *gorm.DB, name string, trafficRatio float64, typeVal int, flow int64, now int64, status int, inIP interface{}, inx int, ipPreference string) (int64, error) {
	inIPVal := nullStringFromInterface(inIP)
	tunnel := model.Tunnel{
		Name:         name,
		TrafficRatio: trafficRatio,
		Type:         typeVal,
		Protocol:     "tls",
		Flow:         flow,
		CreatedTime:  now,
		UpdatedTime:  now,
		Status:       status,
		InIP:         inIPVal,
		Inx:          inx,
		IPPreference: ipPreference,
	}
	if err := tx.Create(&tunnel).Error; err != nil {
		return 0, err
	}
	return tunnel.ID, nil
}

func normalizeNotFoundErr(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return sql.ErrNoRows
	}
	return err
}

func nullStringFromInterface(v interface{}) sql.NullString {
	switch t := v.(type) {
	case nil:
		return sql.NullString{}
	case sql.NullString:
		return t
	case *sql.NullString:
		if t == nil {
			return sql.NullString{}
		}
		return *t
	case string:
		if t == "" {
			return sql.NullString{}
		}
		return sql.NullString{String: t, Valid: true}
	case *string:
		if t == nil || *t == "" {
			return sql.NullString{}
		}
		return sql.NullString{String: *t, Valid: true}
	default:
		return sql.NullString{}
	}
}

func nullInt64FromInterface(v interface{}) sql.NullInt64 {
	switch t := v.(type) {
	case nil:
		return sql.NullInt64{}
	case sql.NullInt64:
		return t
	case *sql.NullInt64:
		if t == nil {
			return sql.NullInt64{}
		}
		return *t
	case int64:
		return sql.NullInt64{Int64: t, Valid: true}
	case *int64:
		if t == nil {
			return sql.NullInt64{}
		}
		return sql.NullInt64{Int64: *t, Valid: true}
	case int:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case int32:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case int16:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case int8:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case uint64:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case uint:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case uint32:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case uint16:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case uint8:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case float64:
		return sql.NullInt64{Int64: int64(t), Valid: true}
	default:
		return sql.NullInt64{}
	}
}

func stringFromInterface(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case sql.NullString:
		if t.Valid {
			return t.String
		}
		return ""
	case *sql.NullString:
		if t != nil && t.Valid {
			return t.String
		}
		return ""
	case []byte:
		return string(t)
	default:
		return ""
	}
}

func parsePortRangeSpec(input string) []int {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil
	}
	set := make(map[int]struct{})
	parts := strings.Split(input, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			r := strings.SplitN(part, "-", 2)
			if len(r) != 2 {
				continue
			}
			start, err1 := strconv.Atoi(strings.TrimSpace(r[0]))
			end, err2 := strconv.Atoi(strings.TrimSpace(r[1]))
			if err1 != nil || err2 != nil || start <= 0 || end <= 0 {
				continue
			}
			if end < start {
				start, end = end, start
			}
			for p := start; p <= end; p++ {
				set[p] = struct{}{}
			}
			continue
		}
		p, err := strconv.Atoi(part)
		if err != nil || p <= 0 {
			continue
		}
		set[p] = struct{}{}
	}
	out := make([]int, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	sort.Ints(out)
	return out
}

func (r *Repository) AddUserToGroups(userID int64, groupIDs []int64, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if len(groupIDs) == 0 {
		return nil
	}
	rows := make([]model.UserGroupUser, 0, len(groupIDs))
	for _, gid := range groupIDs {
		if gid <= 0 {
			continue
		}
		rows = append(rows, model.UserGroupUser{UserGroupID: gid, UserID: userID, CreatedTime: now})
	}
	if len(rows) == 0 {
		return nil
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

func (r *Repository) ReplaceUserGroupsByUserID(userID int64, newGroupIDs []int64, now int64) (affectedGroupIDs []int64, err error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var oldGroupIDs []int64
	if err = r.db.Model(&model.UserGroupUser{}).
		Where("user_id = ?", userID).
		Pluck("user_group_id", &oldGroupIDs).Error; err != nil {
		return nil, err
	}

	seen := make(map[int64]struct{})
	for _, id := range oldGroupIDs {
		seen[id] = struct{}{}
	}
	for _, id := range newGroupIDs {
		if id > 0 {
			seen[id] = struct{}{}
		}
	}
	for id := range seen {
		affectedGroupIDs = append(affectedGroupIDs, id)
	}

	if err = r.db.Where("user_id = ?", userID).Delete(&model.UserGroupUser{}).Error; err != nil {
		return nil, err
	}

	if len(newGroupIDs) == 0 {
		return affectedGroupIDs, nil
	}
	rows := make([]model.UserGroupUser, 0, len(newGroupIDs))
	for _, gid := range newGroupIDs {
		if gid <= 0 {
			continue
		}
		rows = append(rows, model.UserGroupUser{UserGroupID: gid, UserID: userID, CreatedTime: now})
	}
	if len(rows) > 0 {
		if err = r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
			return nil, err
		}
	}
	return affectedGroupIDs, nil
}

type NodeRenewalResult struct {
	NodeID   int64
	NodeName string
	PeriodRx int64
	PeriodTx int64
}

func (r *Repository) AdvanceNodeRenewalCycles(now int64) ([]NodeRenewalResult, error) {
	if r == nil || r.db == nil {
		return nil, nil
	}

	var nodes []model.Node
	if err := r.db.Where("renewal_cycle IS NOT NULL AND renewal_cycle != '' AND expiry_time IS NOT NULL").Find(&nodes).Error; err != nil {
		return nil, fmt.Errorf("list nodes with renewal cycle: %w", err)
	}

	results := []NodeRenewalResult{}
	for _, node := range nodes {
		if !node.ExpiryTime.Valid || node.ExpiryTime.Int64 <= 0 {
			continue
		}

		cycleMonths := 0
		switch node.RenewalCycle.String {
		case "month":
			cycleMonths = 1
		case "quarter":
			cycleMonths = 3
		case "halfyear":
			cycleMonths = 6
		case "year":
			cycleMonths = 12
		default:
			continue
		}

		anchorTime := node.ExpiryTime.Int64
		for anchorTime <= now {
			nextAnchor := advanceByMonths(anchorTime, cycleMonths)
			if nextAnchor <= anchorTime {
				break
			}
			anchorTime = nextAnchor
		}

		if anchorTime == node.ExpiryTime.Int64 {
			continue
		}

		var periodRx, periodTx int64
		var latestMetric model.NodeMetric
		if err := r.db.Where("node_id = ?", node.ID).Order("timestamp DESC").First(&latestMetric).Error; err == nil {
			periodRx = latestMetric.PeriodRx
			periodTx = latestMetric.PeriodTx
		}

		if err := r.db.Model(&model.Node{}).Where("id = ?", node.ID).Update("expiry_time", anchorTime).Error; err != nil {
			continue
		}
		results = append(results, NodeRenewalResult{
			NodeID:   node.ID,
			NodeName: node.Name,
			PeriodRx: periodRx,
			PeriodTx: periodTx,
		})
	}

	return results, nil
}

func advanceByMonths(timestamp int64, months int) int64 {
	t := time.Unix(timestamp/1000, 0)
	next := t.AddDate(0, months, 0)
	return next.UnixMilli()
}

// ─── Tunnel List Grouping ────────────────────────────────────────────

// ListTunnelLists returns all tunnel lists ordered by inx.
func (r *Repository) ListTunnelLists() ([]model.TunnelList, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var lists []model.TunnelList
	err := r.db.Order("inx ASC, id ASC").Find(&lists).Error
	return lists, err
}

// CreateTunnelList creates a new tunnel list.
func (r *Repository) CreateTunnelList(name string, status int, inx int) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	list := model.TunnelList{
		Name:        name,
		Status:      status,
		Inx:         inx,
		CreatedTime: now,
		UpdatedTime: now,
	}
	if err := r.db.Create(&list).Error; err != nil {
		return 0, err
	}
	return list.ID, nil
}

// UpdateTunnelList updates an existing tunnel list.
func (r *Repository) UpdateTunnelList(id int64, name string, status int, inx int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().UnixMilli()
	return r.db.Model(&model.TunnelList{}).Where("id = ?", id).Updates(map[string]interface{}{
		"name":         name,
		"status":       status,
		"inx":          inx,
		"updated_time": now,
	}).Error
}

// DeleteTunnelList deletes a tunnel list and its associations (cascade).
func (r *Repository) DeleteTunnelList(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Delete associations first (cascade should handle this, but be explicit)
		if err := tx.Where("tunnel_list_id = ?", id).Delete(&model.TunnelListTunnel{}).Error; err != nil {
			return err
		}
		// Delete the list
		return tx.Where("id = ?", id).Delete(&model.TunnelList{}).Error
	})
}

// ReplaceTunnelListMembersTx replaces all tunnels in a list (delete + insert).
func (r *Repository) ReplaceTunnelListMembersTx(tx *gorm.DB, listID int64, tunnelIDs []int64, now int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	// Delete existing associations
	if err := tx.Where("tunnel_list_id = ?", listID).Delete(&model.TunnelListTunnel{}).Error; err != nil {
		return err
	}
	// Insert new associations
	if len(tunnelIDs) == 0 {
		return nil
	}
	rows := make([]model.TunnelListTunnel, 0, len(tunnelIDs))
	for i, tunnelID := range tunnelIDs {
		if tunnelID <= 0 {
			continue
		}
		rows = append(rows, model.TunnelListTunnel{
			TunnelListID: listID,
			TunnelID:     tunnelID,
			Inx:          i,
			CreatedTime:  now,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

// UpdateTunnelListOrderTx updates the order of tunnel lists.
func (r *Repository) UpdateTunnelListOrderTx(tx *gorm.DB, orders []struct {
	ID  int64 `json:"id"`
	Inx int   `json:"inx"`
}) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	for _, order := range orders {
		if err := tx.Model(&model.TunnelList{}).Where("id = ?", order.ID).Update("inx", order.Inx).Error; err != nil {
			return err
		}
	}
	return nil
}

// UpdateTunnelListTunnelOrderTx updates the order of tunnels within a list.
func (r *Repository) UpdateTunnelListTunnelOrderTx(tx *gorm.DB, listID int64, orders []struct {
	TunnelID int64 `json:"tunnelId"`
	Inx      int   `json:"inx"`
}) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	for _, order := range orders {
		if err := tx.Model(&model.TunnelListTunnel{}).
			Where("tunnel_list_id = ? AND tunnel_id = ?", listID, order.TunnelID).
			Update("inx", order.Inx).Error; err != nil {
			return err
		}
	}
	return nil
}

// GetTunnelIDsByTunnelList returns all tunnel IDs in a list.
func (r *Repository) GetTunnelIDsByTunnelList(listID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var tunnelIDs []int64
	err := r.db.Model(&model.TunnelListTunnel{}).
		Where("tunnel_list_id = ?", listID).
		Order("inx ASC, id ASC").
		Pluck("tunnel_id", &tunnelIDs).Error
	return tunnelIDs, err
}

type ForwardTrafficResetLogCreateParams struct {
	ForwardID     int64
	ForwardName   string
	UserID        int64
	UserName      string
	ResetTime     int64
	InFlowBefore  int64
	OutFlowBefore int64
	OperatorID    int64
	OperatorName  string
	Reason        string
}

func (r *Repository) ResetForwardTraffic(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Forward{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"in_flow":      0,
			"out_flow":     0,
			"updated_time": time.Now().UnixMilli(),
		}).Error
}

func (r *Repository) CreateForwardTrafficResetLog(params *ForwardTrafficResetLogCreateParams) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if params == nil {
		return errors.New("params is nil")
	}

	log := &model.ForwardTrafficResetLog{
		ForwardID:     params.ForwardID,
		ForwardName:   params.ForwardName,
		UserID:        params.UserID,
		UserName:      params.UserName,
		ResetTime:     params.ResetTime,
		InFlowBefore:  params.InFlowBefore,
		OutFlowBefore: params.OutFlowBefore,
		OperatorID:    params.OperatorID,
		OperatorName:  params.OperatorName,
		Reason:        params.Reason,
		CreatedTime:   time.Now().UnixMilli(),
	}

	if err := r.db.Create(log).Error; err != nil {
		return err
	}

	return r.cleanupForwardTrafficResetLogs(params.ForwardID)
}

func (r *Repository) cleanupForwardTrafficResetLogs(forwardID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	var count int64
	if err := r.db.Model(&model.ForwardTrafficResetLog{}).Where("forward_id = ?", forwardID).Count(&count).Error; err != nil {
		return err
	}

	if count > 30 {
		var cutoffLog model.ForwardTrafficResetLog
		if err := r.db.Where("forward_id = ?", forwardID).
			Order("created_time DESC").
			Offset(29).Limit(1).
			First(&cutoffLog).Error; err != nil {
			return err
		}

		return r.db.Where("forward_id = ? AND created_time < ?", forwardID, cutoffLog.CreatedTime).
			Delete(&model.ForwardTrafficResetLog{}).Error
	}

	return nil
}

type NodeTrafficResetLogCreateParams struct {
	NodeID        int64
	NodeName      string
	ResetTime     int64
	OperatorID    int64
	OperatorName  string
	Reason        string
	InFlowBefore  int64
	OutFlowBefore int64
}

func (r *Repository) CreateNodeTrafficResetLog(params *NodeTrafficResetLogCreateParams) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if params == nil {
		return errors.New("params is nil")
	}

	log := &model.NodeTrafficResetLog{
		NodeID:        params.NodeID,
		NodeName:      params.NodeName,
		ResetTime:     params.ResetTime,
		OperatorID:    params.OperatorID,
		OperatorName:  params.OperatorName,
		Reason:        params.Reason,
		InFlowBefore:  params.InFlowBefore,
		OutFlowBefore: params.OutFlowBefore,
		CreatedTime:   time.Now().UnixMilli(),
	}

	if err := r.db.Create(log).Error; err != nil {
		return err
	}

	return r.cleanupNodeTrafficResetLogs(params.NodeID)
}

// DeductUserBalance atomically deducts balance if sufficient. Returns false if insufficient.
func (r *Repository) DeductUserBalance(userID int64, amount int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}

	result := r.db.Model(&model.User{}).
		Where("id = ? AND balance >= ?", userID, amount).
		Update("balance", gorm.Expr("balance - ?", amount))
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}
	return true, nil
}

// IncreaseUserBalance increases a user's balance by the given amount.
func (r *Repository) IncreaseUserBalance(userID int64, amount int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Update("balance", gorm.Expr("balance + ?", amount)).Error
}

// TryAutoRenewForUser checks if the user qualifies for auto-renewal and triggers it.
func (r *Repository) TryAutoRenewForUser(userID int64) {
	if r == nil || r.db == nil {
		return
	}

	var user model.User
	if err := r.db.Where("id = ?", userID).First(&user).Error; err != nil {
		return
	}

	if user.Status != 0 || user.AutoRenew != 1 || user.RenewalAmount <= 0 || user.Balance < user.RenewalAmount || user.ExpTime > time.Now().UnixMilli() {
		return
	}

	now := time.Now().UnixMilli()
	baseTime := user.ExpTime
	if baseTime < now {
		baseTime = now
	}
	newExpTime := time.UnixMilli(baseTime).AddDate(0, 1, 0).UnixMilli()

	if err := r.RenewUserWithBalance(user.ID, user.RenewalAmount, newExpTime, now); err != nil {
		return
	}

	_ = r.MarkUserAutoRenewSuccess(user.ID, newExpTime, now)
}

// IncreaseUserFlow increases a user's base flow by the given GB amount.
func (r *Repository) IncreaseUserFlow(userID int64, amountGB int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Update("base_flow", gorm.Expr("base_flow + ?", amountGB)).Error
}

// ExtendUserExpiry extends a user's expiry time by the given number of days.
func (r *Repository) ExtendUserExpiry(userID int64, days int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	extension := days * 86400000
	return r.db.Model(&model.User{}).
		Where("id = ?", userID).
		Update("exp_time", gorm.Expr("exp_time + ?", extension)).Error
}

func (r *Repository) cleanupNodeTrafficResetLogs(nodeID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	var count int64
	if err := r.db.Model(&model.NodeTrafficResetLog{}).Where("node_id = ?", nodeID).Count(&count).Error; err != nil {
		return err
	}

	if count > 30 {
		var cutoffLog model.NodeTrafficResetLog
		if err := r.db.Where("node_id = ?", nodeID).
			Order("created_time DESC").
			Offset(29).Limit(1).
			First(&cutoffLog).Error; err != nil {
			return err
		}

		return r.db.Where("node_id = ? AND created_time < ?", nodeID, cutoffLog.CreatedTime).
			Delete(&model.NodeTrafficResetLog{}).Error
	}

	return nil
}

type NodeTrafficLimitItem struct {
	NodeID  int64
	Name    string
	LimitGB int64
	Used    int64
	Mask    int
}

func (r *Repository) ListNodesWithTrafficLimit() ([]NodeTrafficLimitItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []NodeTrafficLimitItem
	err := r.db.Raw(`
		SELECT n.id, n.name, n.traffic_limit,
		       COALESCE(latest.period_rx,0) + COALESCE(latest.period_tx,0) AS used,
		       n.traffic_notified_mask
		FROM node n
		LEFT JOIN (
		    SELECT nm1.node_id, nm1.period_rx, nm1.period_tx
		    FROM node_metric nm1
		    INNER JOIN (
		        SELECT node_id, MAX(timestamp) AS max_ts
		        FROM node_metric GROUP BY node_id
		    ) nm2 ON nm1.node_id = nm2.node_id AND nm1.timestamp = nm2.max_ts
		) latest ON latest.node_id = n.id
		WHERE n.traffic_limit > 0
	`).Scan(&items).Error
	return items, err
}

func (r *Repository) GetNodeTrafficLimitInfo(nodeID int64) (*NodeTrafficLimitItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var item NodeTrafficLimitItem
	err := r.db.Raw(`
		SELECT n.id, n.name, n.traffic_limit,
		       COALESCE(latest.period_rx,0) + COALESCE(latest.period_tx,0) AS used,
		       n.traffic_notified_mask
		FROM node n
		LEFT JOIN (
		    SELECT nm1.node_id, nm1.period_rx, nm1.period_tx
		    FROM node_metric nm1
		    INNER JOIN (
		        SELECT node_id, MAX(timestamp) AS max_ts
		        FROM node_metric GROUP BY node_id
		    ) nm2 ON nm1.node_id = nm2.node_id AND nm1.timestamp = nm2.max_ts
		) latest ON latest.node_id = n.id
		WHERE n.id = ?
	`, nodeID).Scan(&item).Error
	if err != nil {
		return nil, err
	}
	if item.NodeID == 0 {
		return nil, nil
	}
	return &item, nil
}

func (r *Repository) UpdateNodeTrafficNotifiedMask(nodeID int64, mask int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Node{}).Where("id = ?", nodeID).
		Update("traffic_notified_mask", mask).Error
}
