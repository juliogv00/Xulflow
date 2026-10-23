import { useTranslation } from "react-i18next";

/** The supplied VMNTe flow artwork, with its original proportions. */
const XulFlowLogotype = ({
  width = 100,
  height,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  const { t } = useTranslation();
  return (
    <img
      src="/brand/flow-mark.svg"
      width={width}
      height={height}
      className={className}
      alt={t("brand.name")}
      draggable={false}
    />
  );
};
export default XulFlowLogotype;
