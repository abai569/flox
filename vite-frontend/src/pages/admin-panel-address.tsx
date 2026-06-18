import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { useWebViewMode } from "@/hooks/useWebViewMode";
import { reinitializeBaseURL } from "@/api/network";
import {
  requestPanelAddresses,
  savePanelAddress,
  setCurrentPanelAddress,
  deletePanelAddress,
  validatePanelAddress,
  PanelAddress,
} from "@/utils/panel";
import { BackIcon } from "@/components/icons";

export default function AdminPanelAddressPage() {
  const navigate = useNavigate();
  const { isWebView, ready } = useWebViewMode();
  const [addresses, setAddresses] = useState<PanelAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");

  useEffect(() => {
    if (!ready) return;
    if (!isWebView) {
      navigate("/dashboard", { replace: true });
      return;
    }
    loadAddresses();
  }, [isWebView, ready, navigate]);

  const loadAddresses = async () => {
    setLoading(true);
    try {
      const list = await requestPanelAddresses();
      setAddresses(list || []);
    } catch {
      toast.error("获取面板地址失败");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) {
      toast.error("请输入名称");
      return;
    }
    if (!newAddress.trim()) {
      toast.error("请输入面板地址");
      return;
    }
    if (!validatePanelAddress(newAddress.trim())) {
      toast.error("面板地址格式不正确（需以 http:// 或 https:// 开头）");
      return;
    }
    const addr = new URL(newAddress.trim()).origin;
    savePanelAddress(newName.trim(), addr);
    if (addresses.length === 0) {
      setCurrentPanelAddress(newName.trim());
    }
    setAddOpen(false);
    setNewName("");
    setNewAddress("");
    reinitializeBaseURL();
    setTimeout(() => loadAddresses(), 300);
  };

  const handleSwitch = (name: string) => {
    setCurrentPanelAddress(name);
    reinitializeBaseURL();
    toast.success("已切换到: " + name);
    setTimeout(() => loadAddresses(), 300);
  };

  const handleDelete = (name: string) => {
    deletePanelAddress(name);
    reinitializeBaseURL();
    toast.success("已删除: " + name);
    setTimeout(() => loadAddresses(), 300);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-100 dark:bg-black">
      <header className="sticky top-0 bg-white dark:bg-black border-b border-gray-200 dark:border-gray-600 h-14 flex items-center px-4 gap-3 z-10">
        <button
          className="p-1.5 -ml-1.5 text-gray-600 dark:text-gray-300 hover:text-foreground rounded-md transition-colors"
          onClick={() => navigate(-1)}
        >
          <BackIcon size={22} />
        </button>
        <h1 className="text-lg font-semibold text-foreground">面板设置</h1>
        <div className="ml-auto">
          <Button
            color="primary"
            size="sm"
            onPress={() => {
              setNewName("");
              setNewAddress("");
              setAddOpen(true);
            }}
          >
            添加地址
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            加载中...
          </div>
        ) : addresses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
              <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
            </svg>
            <p className="text-sm">暂无已保存的面板地址</p>
            <p className="text-xs">点击右上角"添加地址"开始配置</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {addresses.map((addr) => (
              <div
                key={addr.name}
                className={`bg-white dark:bg-gray-900 border rounded-lg p-4 transition-colors ${
                  addr.inx
                    ? "border-primary-400 dark:border-primary-600 shadow-sm"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground truncate">
                        {addr.name}
                      </span>
                      {addr.inx && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-primary-300 font-medium flex-shrink-0">
                          当前
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                      {addr.address}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!addr.inx && (
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => handleSwitch(addr.name)}
                      >
                        切换
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="flat"
                      color="danger"
                      onPress={() => handleDelete(addr.name)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal
        isOpen={addOpen}
        placement="center"
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false);
            setNewName("");
            setNewAddress("");
          }
        }}
      >
        <ModalContent>
          <ModalHeader>添加面板地址</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                label="名称"
                placeholder="例如：我的面板"
                value={newName}
                variant="bordered"
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                label="面板地址"
                placeholder="https://panel.example.com"
                value={newAddress}
                variant="bordered"
                onChange={(e) => setNewAddress(e.target.value)}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setAddOpen(false);
                setNewName("");
                setNewAddress("");
              }}
            >
              取消
            </Button>
            <Button color="primary" onPress={handleAdd}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
