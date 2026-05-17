import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";

import {
  AnimatedPage,
  StaggerList,
  StaggerItem,
} from "@/components/animated-page";
import { SearchBar } from "@/components/search-bar";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import {
  createSpeedLimit,
  getSpeedLimitList,
  updateSpeedLimit,
  deleteSpeedLimit,
} from "@/api";
import { PageLoadingState } from "@/components/page-state";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
const LIMIT_VIEW_MODE_KEY = "limit_view_mode";

interface SpeedLimitRule {
  id: number;
  name: string;
  speed: number;
  status: number;
  createdTime: string;
  updatedTime: string;
}
interface SpeedLimitForm {
  id?: number;
  name: string;
  speed: number;
  status: number;
}
export default function LimitPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SpeedLimitRule[]>([]);
  const [searchKeyword, setSearchKeyword] = useLocalStorageState(
    "limit-search-keyword",
    "",
  );
  const activeFilterCount = searchKeyword.trim() ? 1 : 0;
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  // 视图模式状态
  const [viewMode, setViewMode] = useState<"card" | "list">(() => {
    const stored = localStorage.getItem(LIMIT_VIEW_MODE_KEY);

    return stored === "list" || stored === "card" ? stored : "card";
  });
  // 列表模式选中行
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const filteredRules = useMemo(() => {
    if (!searchKeyword.trim()) return rules;
    const lowerKeyword = searchKeyword.toLowerCase();

    return rules.filter(
      (r) => r.name && r.name.toLowerCase().includes(lowerKeyword),
    );
  }, [rules, searchKeyword]);
  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<SpeedLimitRule | null>(null);
  // 表单状态
  const [form, setForm] = useState<SpeedLimitForm>({
    name: "",
    speed: 100,
    status: 1,
  });
  // 表单验证错误
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    loadData();
  }, []);
  // 加载所有数据
  const loadData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const rulesRes = await getSpeedLimitList();

      if (rulesRes.code === 0) {
        setRules(rulesRes.data || []);
      } else {
        toast.error(rulesRes.msg || "获取限速规则失败");
      }
    } catch {
      toast.error("加载数据失败");
    } finally {
      if (showLoading) setLoading(false);
    }
  };
  // 视图模式切换
  const handleViewModeToggle = useCallback((mode: "card" | "list") => {
    setViewMode(mode);
    localStorage.setItem(LIMIT_VIEW_MODE_KEY, mode);
  }, []);
  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!form.name.trim()) {
      newErrors.name = "请输入规则名称";
    } else if (form.name.length < 2 || form.name.length > 50) {
      newErrors.name = "规则名称长度应在2-50个字符之间";
    }
    if (!form.speed || form.speed < 1) {
      newErrors.speed = "请输入有效的速度限制（≥1 Mbps）";
    }
    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };
  // 新增规则
  const handleAdd = () => {
    setIsEdit(false);
    setForm({
      name: "",
      speed: 100,
      status: 1,
    });
    setErrors({});
    setModalOpen(true);
  };
  // 编辑规则
  const handleEdit = (rule: SpeedLimitRule) => {
    setIsEdit(true);
    setForm({
      id: rule.id,
      name: rule.name,
      speed: rule.speed,
      status: rule.status,
    });
    setErrors({});
    setModalOpen(true);
  };
  // 显示删除确认
  const handleDelete = (rule: SpeedLimitRule) => {
    setRuleToDelete(rule);
    setDeleteModalOpen(true);
  };
  // 确认删除规则
  const confirmDelete = async () => {
    if (!ruleToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await deleteSpeedLimit(ruleToDelete.id);

      if (res.code === 0) {
        toast.success("删除成功");
        setDeleteModalOpen(false);
        loadData(false);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setDeleteLoading(false);
    }
  };
  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      let res: { code: number; msg: string };
      const payload = {
        id: form.id,
        name: form.name,
        speed: form.speed,
        status: form.status,
      };

      if (isEdit) {
        res = await updateSpeedLimit(payload);
      } else {
        const createData = {
          name: payload.name,
          speed: payload.speed,
          status: payload.status,
        };

        res = await createSpeedLimit(createData);
      }
      if (res.code === 0) {
        toast.success(isEdit ? "更新成功" : "创建成功");
        setModalOpen(false);
        loadData(false);
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("操作失败");
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return <PageLoadingState message="正在加载..." />;
  }

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex flex-row items-center mb-6 gap-3">
        <div className="flex items-center gap-2">
          <SearchBar
            isVisible={isSearchVisible}
            placeholder="搜索规则名称"
            value={searchKeyword}
            onChange={setSearchKeyword}
            onClose={() => setIsSearchVisible(false)}
            onOpen={() => {
              setIsSearchVisible(true);
              setTimeout(() => {
                const searchInput = document.querySelector(
                  'input[placeholder*="搜索"]',
                );

                if (searchInput) (searchInput as HTMLElement).focus();
              }, 150);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {/* 视图模式切换按钮 */}
          <Button
            color={viewMode === "card" ? "primary" : "warning"}
            size="sm"
            variant="flat"
            onPress={() =>
              handleViewModeToggle(viewMode === "card" ? "list" : "card")
            }
          >
            {viewMode === "card" ? "卡片" : "列表"}
          </Button>
          <Button color="primary" size="sm" variant="flat" onPress={handleAdd}>
            新增
          </Button>
          {activeFilterCount > 0 && (
            <Button
              color="warning"
              size="sm"
              variant="flat"
              onPress={() => setSearchKeyword("")}
            >
              重置
            </Button>
          )}
        </div>
      </div>
      {/* 限速规则列表 */}
      {filteredRules.length > 0 ? (
        viewMode === "list" ? (
          <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
            <Table
              aria-label="限速规则列表"
              classNames={{
                th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
                  限速名称
                  <span className="text-xs text-primary-500 font-normal">
                    ^{filteredRules.length}个
                  </span>
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
                  速度限制
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[80px] text-left">
                  状态
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                  创建时间
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                  更新时间
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
                  操作
                </TableColumn>
              </TableHeader>
              <TableBody>
                {filteredRules.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className={`cursor-pointer transition-colors ${selectedRuleId === rule.id
                        ? "bg-primary-50 dark:bg-primary-900/30"
                        : "hover:bg-default-50/50"
                      }`}
                    onClick={() => {
                      if (selectedRuleId !== rule.id) {
                        setSelectedRuleId(rule.id);
                      }
                    }}
                  >
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium text-foreground truncate">
                        {rule.name}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-secondary-500/10 text-secondary-600 dark:text-secondary-400">
                        {rule.speed}M
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div
                        className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${rule.status === 1 ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                      >
                        {rule.status === 1 ? "运行" : "异常"}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-sm text-default-600">
                        {new Date(rule.createdTime).toLocaleString("zh-CN")}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-sm text-default-600">
                        {new Date(rule.updatedTime).toLocaleString("zh-CN")}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex gap-1.5">
                        <Button
                          className="min-h-7 px-2"
                          color="primary"
                          size="sm"
                          variant="flat"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onPress={() => handleEdit(rule)}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          编辑
                        </Button>
                        <Button
                          className="min-h-7 px-2"
                          color="danger"
                          size="sm"
                          variant="flat"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onPress={() => handleDelete(rule)}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
            <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
              <span className="text-sm font-semibold text-foreground">
                admin
              </span>
              <span className="text-xs text-default-500">
                {filteredRules.length} 个限速
              </span>
            </div>
            <div className="p-4">
              <StaggerList className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {filteredRules.map((rule) => (
                  <StaggerItem key={rule.id}>
                    <Card className="shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden h-full">
                      <CardHeader className="pb-2 md:pb-2">
                        <div className="flex justify-between items-start w-full">
                          <div>
                            <h3 className="font-semibold text-foreground">
                              {rule.name}
                            </h3>
                          </div>
                          <div
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${rule.status === 1 ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                          >
                            {rule.status === 1 ? "运行" : "异常"}
                          </div>
                        </div>
                      </CardHeader>
                      <CardBody className="pt-0 pb-3 md:pt-0 md:pb-3">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-small text-default-600">
                              速度限制
                            </span>
                            <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-secondary-500/10 text-secondary-600 dark:text-secondary-400">
                              {rule.speed}M
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button
                            className="flex-1"
                            color="primary"
                            size="sm"
                            variant="flat"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                            }}
                            onPress={() => handleEdit(rule)}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            className="flex-1"
                            color="danger"
                            size="sm"
                            variant="flat"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                            }}
                            onPress={() => handleDelete(rule)}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      </CardBody>
                    </Card>
                  </StaggerItem>
                ))}
              </StaggerList>
            </div>
          </div>
        )
      ) : (
        <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
          <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
              暂无限速规则
            </h3>
            <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
              还没有任何限速规则，点击新增按钮开始创建
            </p>
          </CardBody>
        </Card>
      )}
      {/* 新增/编辑模态框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={modalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onOpenChange={setModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">
                  {isEdit ? "编辑限速规则" : "新增限速规则"}
                </h2>
                <p className="text-small text-default-500">
                  {isEdit ? "修改现有限速规则的配置信息" : "创建新的限速规则"}
                </p>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    errorMessage={errors.name}
                    isInvalid={!!errors.name}
                    label="规则名称"
                    placeholder="请输入限速规则名称"
                    value={form.name}
                    variant="bordered"
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                  <Input
                    endContent={
                      <div className="pointer-events-none flex items-center">
                        <span className="text-default-400 text-small">
                          Mbps
                        </span>
                      </div>
                    }
                    errorMessage={errors.speed}
                    isInvalid={!!errors.speed}
                    label="速度限制"
                    placeholder="请输入速度限制"
                    type="number"
                    value={form.speed.toString()}
                    variant="bordered"
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        speed: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isLoading={submitLoading}
                  onPress={handleSubmit}
                >
                  {isEdit ? "保存" : "创建"}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 删除确认模态框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={deleteModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onOpenChange={setDeleteModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-lg font-bold text-danger">确认删除</h2>
              </ModalHeader>
              <ModalBody>
                <p className="text-default-600">
                  确定要删除限速规则{" "}
                  <span className="font-semibold text-foreground">
                    &quot;{ruleToDelete?.name}&quot;
                  </span>{" "}
                  吗？
                </p>
                <p className="text-small text-default-500 mt-2">
                  此操作无法撤销，删除后该规则将永久消失。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="danger"
                  isLoading={deleteLoading}
                  onPress={confirmDelete}
                >
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
