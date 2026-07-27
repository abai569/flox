import type {
  TunnelGroupNewApiItem,
  TunnelGroupNewMutationPayload,
} from "@/api/types";

import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { Edit, Trash2 } from "lucide-react";

import { formatRemoteDisplayText } from "@/utils/remoteDisplay";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Textarea } from "@/shadcn-bridge/heroui/input";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/shadcn-bridge/heroui/table";
import {
  getTunnelGroupNewList,
  createTunnelGroupNew,
  updateTunnelGroupNew,
  deleteTunnelGroupNew,
  getTunnelList,
  assignTunnelToGroupNew,
} from "@/api";

interface TunnelGroupManagerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupChange?: () => void;
}

export function TunnelGroupManager({
  isOpen,
  onOpenChange,
  onGroupChange,
}: TunnelGroupManagerProps) {
  const [groups, setGroups] = useState<TunnelGroupNewApiItem[]>([]);
  const [allTunnels, setAllTunnels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingGroup, setEditingGroup] =
    useState<TunnelGroupNewApiItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 🎯 修复：统一加载函数，确保分组和隧道数据同步
  const loadAllData = async () => {
    setLoading(true);
    try {
      const [res, tunnelRes] = await Promise.all([
        getTunnelGroupNewList(),
        getTunnelList(),
      ]);

      setGroups(res.data || []);
      setAllTunnels(tunnelRes.data || []);
    } catch (error) {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAllData();
    }
  }, [isOpen]);

  const handleOpenModal = (group?: TunnelGroupNewApiItem) => {
    setEditingGroup(group || null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingGroup(null);
  };

  const handleSave = async (
    data: TunnelGroupNewMutationPayload,
    selectedTunnelIds: number[],
  ) => {
    try {
      let groupId: number | undefined;

      if (editingGroup) {
        await updateTunnelGroupNew({ ...data, id: editingGroup.id });
        groupId = editingGroup.id;
      } else {
        const res: any = await createTunnelGroupNew(data);

        groupId = res.data?.id;
      }

      if (groupId && groupId > 0) {
        const assignRes = await assignTunnelToGroupNew({
          groupId,
          tunnelIds: selectedTunnelIds,
        });

        if (assignRes.code !== 0) {
          toast.error(assignRes.msg || "分组成员保存失败");

          return;
        }
      }

      toast.success("保存成功");
      // 立即通知父组件刷新隧道列表（在关闭对话框之前）
      onGroupChange?.();
      await loadAllData();
      handleCloseModal();
    } catch (error: any) {
      console.error("保存操作崩溃:", error);
      toast.error(error?.msg || error?.message || "保存失败，请检查网络");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除此分组吗？分组下的隧道将被设为未分组。")) return;
    try {
      await deleteTunnelGroupNew(id);
      toast.success("删除成功");
      // 立即通知父组件刷新隧道列表（在关闭对话框之前）
      onGroupChange?.();
      await loadAllData();
    } catch (error) {
      toast.error("删除失败");
    }
  };

  const displayGroups = useMemo(() => {
    const uncategorizedGroup = {
      id: -1,
      name: "未分组隧道",
      description: "",
      color: "#a1a1aa", // 采用低调的灰色
      inx: 0,
    } as any;

    // 把虚拟分组和真实分组拼在一起，统一按照 inx 从小到大排序
    return [uncategorizedGroup, ...groups].sort(
      (a, b) => (a.inx || 0) - (b.inx || 0),
    );
  }, [groups]);

  return (
    <>
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={isOpen}
        placement="center"
        scrollBehavior="inside"
        size="2xl"
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          <ModalHeader>隧道分组管理</ModalHeader>
          <ModalBody>
            <div className="mb-4">
              <Button color="primary" onClick={() => handleOpenModal()}>
                创建分组
              </Button>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" />
              </div>
            ) : groups.length === 0 ? (
              <div className="text-center py-8 text-gray-500">暂无分组</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
                <Table
                  aria-label="隧道分组列表"
                  classNames={{
                    th: "bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                    td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                    tr: "hover:bg-default-50/50 transition-colors",
                    wrapper: "shadow-none p-0 overflow-x-auto",
                    // @ts-ignore
                    table: "min-w-[580px]",
                  }}
                >
                  <TableHeader>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[220px] text-left">
                      分组名
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-center">
                      排序
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-center">
                      {" "}
                      隧道数
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
                      颜色
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
                      {" "}
                      操作
                    </TableColumn>
                  </TableHeader>
                  <TableBody emptyContent="暂无分组" items={displayGroups}>
                    {(group) => (
                      <TableRow
                        key={group.id}
                        className="hover:bg-default-50/50 transition-colors"
                      >
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: group.color }}
                            />
                            <span className="font-bold text-default-700">
                              {group.name}
                            </span>
                          </div>
                          {group.description && (
                            <div className="text-xs text-default-500 mt-1 truncate max-w-[180px]">
                              {group.description}
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            <div className="inline-flex items-center justify-center bg-blue-500/10 text-blue-600 px-2.5 py-0.5 rounded-md text-sm font-bold font-mono">
                              {group.inx || 0}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            <div className="inline-flex items-center justify-center bg-purple-500/10 text-purple-600 px-2.5 py-0.5 rounded-md text-sm font-bold font-mono">
                              {group.id === -1
                                ? allTunnels.filter(
                                    (t) =>
                                      !t.tunnelGroupIds ||
                                      t.tunnelGroupIds.length === 0,
                                  ).length
                                : allTunnels.filter((t) =>
                                    t.tunnelGroupIds?.includes(group.id),
                                  ).length}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center justify-start items-center gap-2">
                            <div
                              className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                              style={{ backgroundColor: group.color }}
                            />
                            <span className="text-sm text-default-600 font-mono">
                              {group.color}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center justify-start gap-2">
                            <Button
                              isIconOnly
                              className="bg-blue-50 text-blue-600 hover:bg-blue-100 w-8 h-8 min-w-8"
                              size="sm"
                              variant="flat"
                              onPress={() => handleOpenModal(group)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              isIconOnly
                              className="bg-danger-50 text-danger hover:bg-danger-100 w-8 h-8 min-w-8"
                              isDisabled={group.id === -1}
                              size="sm"
                              variant="flat"
                              onPress={() => handleDelete(group.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <GroupEditModal
        allTunnels={allTunnels}
        group={editingGroup}
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        onSave={handleSave}
      />
    </>
  );
}

interface GroupEditModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  group: TunnelGroupNewApiItem | null;
  allTunnels: any[];
  onSave: (
    data: TunnelGroupNewMutationPayload,
    selectedTunnelIds: number[],
  ) => void;
}

function GroupEditModal({
  isOpen,
  onOpenChange,
  group,
  allTunnels,
  onSave,
}: GroupEditModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [inx, setInx] = useState(0);
  const [selectedTunnelIds, setSelectedTunnelIds] = useState<number[]>([]);

  useEffect(() => {
    if (group && isOpen) {
      setName(group.name);
      setDescription(group.description || "");
      setColor(group.color || "#3b82f6");
      setInx(group.inx || 0);
      const currentTunnels =
        group.id === -1
          ? allTunnels
              .filter((t) => !t.tunnelGroupIds || t.tunnelGroupIds.length === 0)
              .map((t) => t.id)
          : allTunnels
              .filter((t) => t.tunnelGroupIds?.includes(group.id))
              .map((t) => t.id);

      setSelectedTunnelIds(currentTunnels);
    } else if (isOpen) {
      setName("");
      setDescription("");
      setColor("#3b82f6");
      setInx(0);
      setSelectedTunnelIds([]);
    }
  }, [group, isOpen, allTunnels]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (group && group.id === -1) {
      toast.success(
        "「未分组」为系统默认状态仅供查看，请前往具体分组去分配隧道",
      );
      onOpenChange(false);

      return;
    }
    if (!name.trim()) {
      toast.error("分组名称不能为空");

      return;
    }
    onSave(
      { name, description, color, inx: Number(inx) || 0 },
      selectedTunnelIds,
    );
  };

  const presetColors = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];

  return (
    <Modal
      backdrop="blur"
      classNames={{
        base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
      }}
      isOpen={isOpen}
      placement="center"
      scrollBehavior="inside"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        <form
          className="flex flex-col flex-1 w-full min-h-0"
          onSubmit={handleSubmit}
        >
          <ModalHeader>{group ? "编辑分组" : "创建分组"}</ModalHeader>
          <ModalBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                分组名称 *
              </label>
              <Input
                required
                placeholder="输入分组名称"
                readOnly={group?.id === -1}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">描述</label>
              <Textarea
                classNames={{
                  inputWrapper: "!min-h-[20px] py-1.5",
                  input: "!min-h-[20px]",
                }}
                placeholder="分组描述（可选）"
                readOnly={group?.id === -1}
                rows={1}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">分配隧道</label>
              <Select
                placeholder="选择要加入此分组的隧道"
                selectedKeys={new Set(selectedTunnelIds.map(String))}
                selectionMode="multiple"
                variant="bordered"
                onSelectionChange={(keys: any) => {
                  if (keys === "all") {
                    setSelectedTunnelIds(allTunnels.map((t) => t.id));
                  } else {
                    setSelectedTunnelIds(Array.from(keys).map(Number));
                  }
                }}
              >
                {(group?.id === -1
                  ? allTunnels.filter(
                      (t) => !t.tunnelGroupIds || t.tunnelGroupIds.length === 0,
                    )
                  : allTunnels
                ).map((tunnel: any) => (
                  <SelectItem
                    key={tunnel.id.toString()}
                    textValue={formatRemoteDisplayText(tunnel.name)}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm">
                        {formatRemoteDisplayText(tunnel.name)}
                      </span>
                      <span className="text-xs text-default-400">
                        {tunnel.inIp || "未知入口 IP"}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">颜色</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {presetColors.map((c) => (
                  <button
                    key={c}
                    className={`w-8 h-8 rounded border-2 ${
                      color === c ? "border-gray-900" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    type="button"
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="w-10 h-10 border rounded cursor-pointer"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
                <Input
                  className="flex-1"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">排序</label>
              <Input
                placeholder="数字越小越靠前"
                readOnly={group?.id === -1}
                type="number"
                value={String(inx) === "" ? "" : String(inx)}
                onChange={(e) =>
                  setInx(
                    e.target.value === ""
                      ? ("" as any)
                      : parseInt(e.target.value),
                  )
                }
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="flat"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button color="primary" type="submit">
              保存
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
