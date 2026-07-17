import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import toast from "react-hot-toast";

import { importRemoteNode } from "@/api";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";

interface NodeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function NodeImportModal({
  isOpen,
  onClose,
  onImported,
}: NodeImportModalProps) {
  const [remoteUrl, setRemoteUrl] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRemoteUrl("");
      setToken("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!remoteUrl.trim() || !token.trim()) {
      toast.error("请填写远程面板地址和 Token");

      return;
    }

    let normalizedUrl = remoteUrl.trim();

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `http://${normalizedUrl}`;
    }

    setLoading(true);
    try {
      const res = await importRemoteNode({
        remoteUrl: normalizedUrl,
        token: token.trim(),
      });

      if (res.code !== 0) {
        toast.error(res.msg || "导入远程节点失败");

        return;
      }
      toast.success("远程节点已导入");
      onClose();
      onImported();
    } catch {
      toast.error("导入远程节点失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isDismissable={false} isOpen={isOpen} onClose={onClose}>
      <ModalContent>
        <ModalHeader>导入远程节点</ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label="远程面板地址"
            placeholder="https://panel.example.com"
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
          />
          <Input
            label="分享 Token"
            placeholder="输入提供方生成的 Token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={loading} variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button color="secondary" isLoading={loading} onPress={handleSubmit}>
            <Download className="h-4 w-4" />
            导入
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
