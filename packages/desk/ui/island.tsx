import {
  Button,
  Card,
  Collapse,
  Footer,
  Input,
  Switch,
  Tag,
  Title,
  type ButtonProps,
  type CardProps,
  type CollapseProps,
  type FooterProps,
  type InputProps,
  type SwitchProps,
  type TagProps,
  type TitleProps,
} from "animal-island-ui";

export function IslandButton({ size = "small", ...props }: ButtonProps) {
  return <Button size={size} {...props} />;
}

export function IslandInput({ shadow = false, ...props }: InputProps) {
  return <Input shadow={shadow} {...props} />;
}

export function IslandCard(props: CardProps) {
  return <Card {...props} />;
}

export function IslandTag({ size = "small", variant = "soft", ...props }: TagProps) {
  return <Tag size={size} variant={variant} {...props} />;
}

export function IslandSwitch({ size = "small", ...props }: SwitchProps) {
  return <Switch size={size} {...props} />;
}

export function IslandCollapse(props: CollapseProps) {
  return <Collapse {...props} />;
}

export function IslandTitle({ size = "middle", color = "app-teal", ...props }: TitleProps) {
  return <Title size={size} color={color} {...props} />;
}

export function IslandFooter({ type = "tree", ...props }: FooterProps) {
  return <Footer type={type} {...props} />;
}
