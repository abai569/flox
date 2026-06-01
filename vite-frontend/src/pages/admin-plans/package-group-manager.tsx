import type {
  PackageGroupApiItem,
  PackageGroupMutationPayload,
  SubscriptionPackageApiItem,
} from "@/api/types";

import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { Edit, Trash2 } from "lucide-react";

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
  getPackageGroupList,
  createPackageGroup,
  updatePackageGroup,
  deletePackageGroup,
  getPackageList,
  assignPackageToGroup,
} from "@/api";

const typeLabels: Record<string, string> = {
  subscription: "订阅",
  traffic: "流量",
  balance: "余额",
};

interface PackageGroupManagerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupChange?: () => void;
}

export function PackageGroupManager({
  isOpen,
  onOpenChange,
  onGroupChange,
}: PackageGroupManagerProps) {
  const [groups, setGroups] = useState<PackageGroupApiItem[]>([]);
  const [allPackages, setAllPackages] = useState<SubscriptionPackageApiItem[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PackageGroupApiItem | null>(
    null,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadGroups = async () => {
    setLoading(true);
    try {
      const [res, pkgRes] = await Promise.all([
        getPackageGroupList(),
        getPackageList(),
      ]);

      setGroups(res.data || []);
      setAllPackages(pkgRes.data || []);
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadGroups();
    }
  }, [isOpen]);

  const handleOpenModal = (group?: PackageGroupApiItem) => {
    setEditingGroup(group || null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingGroup(null);
  };

  const handleSave = async (
    data: PackageGroupMutationPayload,
    selectedPackageIds: number[],
  ) => {
    try {
      let groupId: number;

      if (editingGroup) {
        await updatePackageGroup({ ...data, id: editingGroup.id });
        groupId = editingGroup.id;
        toast.success("分组更新成功");
      } else {
        const res: any = await createPackageGroup(data);

        groupId = res.data.id;
        toast.success("分组创建成功");
      }

      const originalPackages = editingGroup
        ? allPackages
            .filter((p) => p.groupId === editingGroup.id)
            .map((p) => p.id)
        : [];

      const toAdd = selectedPackageIds.filter(
        (id) => !originalPackages.includes(id),
      );
      const toRemove = originalPackages.filter(
        (id) => !selectedPackageIds.includes(id),
      );

      if (toAdd.length > 0 || toRemove.length > 0) {
        await Promise.all([
          ...toAdd.map((id) => assignPackageToGroup(id, groupId)),
          ...toRemove.map((id) => assignPackageToGroup(id, null)),
        ]);
      }

      handleCloseModal();
      await loadGroups();
      onGroupChange?.();
    } catch {
      toast.error(editingGroup ? "更新分组失败" : "创建分组失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除此分组吗？分组下的套餐将被设为未分组。")) {
      return;
    }
    try {
      await deletePackageGroup(id);
      toast.success("分组删除成功");
      await loadGroups();
      onGroupChange?.();
    } catch {
      toast.error("删除分组失败");
    }
  };

  const displayGroups = useMemo(() => {
    const uncategorizedGroup = {
      id: -1,
      name: "未分组套餐",
      description: "",
      color: "#a1a1aa",
      inx: 0,
    } as any;

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
          <ModalHeader>套餐分组管理</ModalHeader>
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
                  aria-label="套餐分组列表"
                  classNames={{
                    th: "bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                    td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                    tr: "hover:bg-default-50/50 transition-colors",
                    wrapper: "shadow-none p-0 overflow-x-auto",
                  }}
                >
                  <TableHeader>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[220px] text-left">
                      分组名称
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-center">
                      排序
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-center">
                      套餐数
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
                      颜色
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
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
                                ? allPackages.filter(
                                    (n) => !n.groupId || n.groupId === 0,
                                  ).length
                                : group.packageCount}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
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
                          <div className="flex items-center gap-2">
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
        allPackages={allPackages}
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
  group: PackageGroupApiItem | null;
  allPackages: SubscriptionPackageApiItem[];
  onSave: (
    data: PackageGroupMutationPayload,
    selectedPackageIds: number[],
  ) => void;
}

function GroupEditModal({
  isOpen,
  onOpenChange,
  group,
  allPackages,
  onSave,
}: GroupEditModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [inx, setInx] = useState(0);
  const [selectedPackageIds, setSelectedPackageIds] = useState<number[]>([]);

  useEffect(() => {
    if (group) {
      setName(group.name);
      setDescription(group.description || "");
      setColor(group.color);
      setInx(group.inx || 0);
      const currentPackages =
        group.id === -1
          ? allPackages
              .filter((n) => !n.groupId || n.groupId === 0)
              .map((n) => n.id)
          : allPackages.filter((n) => n.groupId === group.id).map((n) => n.id);

      setSelectedPackageIds(currentPackages);
    } else {
      setName("");
      setDescription("");
      setColor("#3b82f6");
      setInx(0);
      setSelectedPackageIds([]);
    }
  }, [group, isOpen, allPackages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("分组名称不能为空");

      return;
    }
    onSave(
      { name, description, color, inx: Number(inx) || 0 },
      selectedPackageIds,
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
          <ModalBody>
            <div className="space-y-4">
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
                <label className="block text-sm font-medium mb-1">
                  分配套餐
                </label>
                <Select
                  placeholder="选择要加入此分组的套餐"
                  selectedKeys={new Set(selectedPackageIds.map(String))}
                  selectionMode="multiple"
                  variant="bordered"
                  onSelectionChange={(keys) =>
                    setSelectedPackageIds(Array.from(keys).map(Number))
                  }
                >
                  {(group?.id === -1
                    ? allPackages.filter(
                        (p: any) => !p.groupId || p.groupId === 0,
                      )
                    : allPackages
                  ).map((pkg: any) => (
                    <SelectItem key={String(pkg.id)} textValue={pkg.name}>
                      <div className="flex flex-col">
                        <span className="text-sm">{pkg.name}</span>
                        <span className="text-xs text-default-400">
                          {typeLabels[pkg.type] || pkg.type}
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
                      disabled={group?.id === -1}
                      style={{ backgroundColor: c }}
                      type="button"
                      onClick={() => group?.id !== -1 && setColor(c)}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="w-10 h-10 border rounded cursor-pointer"
                    disabled={group?.id === -1}
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <Input
                    className="flex-1"
                    readOnly={group?.id === -1}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">排序</label>
                <Input
                  placeholder="数字越小越靠前"
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
